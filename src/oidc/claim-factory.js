/**
 * Builds token claims from an account document plus the requesting context
 * (serviceId/relationshipId from the authorization request). Pure function: the token
 * always reflects exactly what is stored on the account, with no policy-specific branching.
 */

import crypto from 'node:crypto'

const formatRelationship = ({ relationshipId, organisationId, organisationName, organisationLoa, relationship, relationshipLoa }) =>
  // Citizen relationships have no organisation - default the segment to empty/0 rather than the literal "undefined"
  `${relationshipId}:${organisationId ?? ''}:${organisationName ?? ''}:${organisationLoa ?? 0}:${relationship}:${relationshipLoa}`

const formatRole = (relationshipId, { roleName, status }) => `${relationshipId}:${roleName}:${status}`

const totalRoles = (relationships, serviceId) =>
  relationships.reduce((count, relationship) => count + relationship.roles.filter((role) => role.serviceId === serviceId).length, 0)

const totalEnrolmentRequests = (relationships) =>
  relationships.reduce((count, relationship) => count + relationship.enrolmentRequestCount, 0)

/**
 * @param {object} account - Account document
 * @param {object} request
 * @param {string} request.serviceId - serviceId from the authorization request
 * @param {string} [request.relationshipId] - relationshipId from the authorization request, if supplied
 * @returns {object} Token claims
 */
export function buildAccountClaims (account, { serviceId, relationshipId } = {}) {
  // A relationship is only relevant to this token if it has at least one role for the
  // requesting serviceId - relationships with no matching role are not returned at all.
  const selectedRelationships = account.relationships.filter((entry) =>
    (relationshipId === undefined || entry.relationshipId === relationshipId) &&
    entry.roles.some((role) => role.serviceId === serviceId))

  const currentRelationshipId = relationshipId ?? selectedRelationships[0]?.relationshipId

  const roles = selectedRelationships.flatMap((entry) =>
    entry.roles
      .filter((role) => role.serviceId === serviceId)
      .map((role) => formatRole(entry.relationshipId, role)))

  return {
    sub: account.sub,
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    contactId: account.contactId,
    ...(account.uniqueReference !== undefined && { uniqueReference: account.uniqueReference }),
    loa: account.loa,
    amr: account.amr,
    serviceId,
    correlationId: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
    currentRelationshipId,
    relationships: selectedRelationships.map(formatRelationship),
    roles,
    enrolmentCount: totalRoles(account.relationships, serviceId),
    enrolmentRequestCount: totalEnrolmentRequests(account.relationships)
  }
}

export default { buildAccountClaims }
