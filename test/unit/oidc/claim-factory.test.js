import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildAccountClaims } from '../../../src/oidc/claim-factory.js'

function createAccount (overrides = {}) {
  return {
    sub: 'sub-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Standard',
    contactId: 'contact-1',
    uniqueReference: 'unique-1',
    loa: 2,
    amr: 'scp',
    relationships: [
      {
        relationshipId: 'rel-1',
        organisationId: 'org-1',
        organisationName: 'Acme Farm Ltd',
        organisationLoa: 2,
        relationship: 'Employee',
        relationshipLoa: 2,
        roles: [
          { serviceId: 'service-a', roleName: 'Finance Officer', status: 3 }
        ],
        enrolmentRequestCount: 2
      },
      {
        relationshipId: 'rel-2',
        organisationId: 'org-2',
        organisationName: 'Beta Holdings Ltd',
        organisationLoa: 1,
        relationship: 'Agent',
        relationshipLoa: 1,
        roles: [
          { serviceId: 'service-b', roleName: 'Reader', status: 1 },
          { serviceId: 'service-a', roleName: 'Writer', status: 3 }
        ],
        enrolmentRequestCount: 3
      }
    ],
    ...overrides
  }
}

describe('buildAccountClaims', () => {
  it('passes account fields straight through and echoes the requested serviceId', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-a' })

    assert.equal(claims.sub, 'sub-1')
    assert.equal(claims.email, 'alice@example.com')
    assert.equal(claims.firstName, 'Alice')
    assert.equal(claims.lastName, 'Standard')
    assert.equal(claims.contactId, 'contact-1')
    assert.equal(claims.uniqueReference, 'unique-1')
    assert.equal(claims.loa, 2)
    assert.equal(claims.amr, 'scp')
    assert.equal(claims.serviceId, 'service-a')
  })

  it('omits uniqueReference entirely when absent from the account (SFI accounts)', () => {
    const account = createAccount()
    delete account.uniqueReference

    const claims = buildAccountClaims(account, { serviceId: 'service-a' })

    assert.equal('uniqueReference' in claims, false)
  })

  it('generates a fresh correlationId and sessionId on every call', () => {
    const account = createAccount()
    const first = buildAccountClaims(account, { serviceId: 'service-a' })
    const second = buildAccountClaims(account, { serviceId: 'service-a' })

    assert.notEqual(first.correlationId, second.correlationId)
    assert.notEqual(first.sessionId, second.sessionId)
  })

  it('includes all relationships and defaults currentRelationshipId to the first when relationshipId is not supplied', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-a' })

    assert.equal(claims.currentRelationshipId, 'rel-1')
    assert.deepEqual(claims.relationships, [
      'rel-1:org-1:Acme Farm Ltd:2:Employee:2',
      'rel-2:org-2:Beta Holdings Ltd:1:Agent:1'
    ])
  })

  it('filters relationships to the matching relationshipId when supplied', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-a', relationshipId: 'rel-2' })

    assert.equal(claims.currentRelationshipId, 'rel-2')
    assert.deepEqual(claims.relationships, ['rel-2:org-2:Beta Holdings Ltd:1:Agent:1'])
  })

  it('returns an empty relationships array when relationshipId does not match any entry', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-a', relationshipId: 'unknown' })

    assert.deepEqual(claims.relationships, [])
    assert.equal(claims.currentRelationshipId, 'unknown')
  })

  it('defaults missing organisation fields to empty/0 for Citizen relationships instead of the literal "undefined"', () => {
    const account = createAccount({
      relationships: [
        {
          relationshipId: 'rel-3',
          relationship: 'Citizen',
          relationshipLoa: 0,
          roles: [{ serviceId: 'service-a', roleName: 'Applicant', status: 2 }],
          enrolmentRequestCount: 0
        }
      ]
    })

    const claims = buildAccountClaims(account, { serviceId: 'service-a' })

    assert.deepEqual(claims.relationships, ['rel-3:::0:Citizen:0'])
  })

  it('only includes relationships that have at least one role for the requested serviceId', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-b' })

    assert.equal(claims.currentRelationshipId, 'rel-2')
    assert.deepEqual(claims.relationships, ['rel-2:org-2:Beta Holdings Ltd:1:Agent:1'])
  })

  it('excludes relationships entirely, and leaves currentRelationshipId undefined, when no relationship has a role for the requested serviceId', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-c' })

    assert.deepEqual(claims.relationships, [])
    assert.equal(claims.currentRelationshipId, undefined)
  })

  it('formats roles prefixed by their parent relationshipId, filtered to the current serviceId', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-b', relationshipId: 'rel-2' })

    assert.deepEqual(claims.roles, ['rel-2:Reader:1'])
  })

  it('excludes roles tied to a different serviceId', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-a' })

    assert.deepEqual(claims.roles, ['rel-1:Finance Officer:3', 'rel-2:Writer:3'])
  })

  it('computes enrolmentCount as the total of roles matching the requested serviceId, across all relationships', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-a', relationshipId: 'rel-1' })

    assert.equal(claims.enrolmentCount, 2)
  })

  it('computes enrolmentRequestCount as an unfiltered total across all relationships', () => {
    const claims = buildAccountClaims(createAccount(), { serviceId: 'service-a', relationshipId: 'rel-1' })

    assert.equal(claims.enrolmentRequestCount, 5)
  })
})
