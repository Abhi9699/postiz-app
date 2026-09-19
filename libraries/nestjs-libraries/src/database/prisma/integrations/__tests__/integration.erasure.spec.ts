import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock bcrypt so native addon is not required for unit testing
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed'),
    hashSync: vi.fn().mockReturnValue('hashed'),
    compare: vi.fn().mockResolvedValue(true),
    compareSync: vi.fn().mockReturnValue(true),
  },
  hash: vi.fn().mockResolvedValue('hashed'),
  hashSync: vi.fn().mockReturnValue('hashed'),
  compare: vi.fn().mockResolvedValue(true),
  compareSync: vi.fn().mockReturnValue(true),
}));

import { IntegrationRepository } from '../integration.repository';
import { OrganizationRepository } from '../../organizations/organization.repository';

describe('G1 Postiz Fork Credential Erasure on Delete (§A #90)', () => {
  let mockIntegrationDb: any[];
  let mockCustomerDb: any[];
  let integrationRepo: IntegrationRepository;
  let organizationRepo: OrganizationRepository;

  beforeEach(() => {
    mockIntegrationDb = [
      {
        id: 'integration-target',
        organizationId: 'org-1',
        customerId: 'customer-1',
        name: 'LinkedIn Target',
        providerIdentifier: 'linkedin',
        token: 'active-access-token-123',
        refreshToken: 'active-refresh-token-456',
        customInstanceDetails: 'encrypted-secret-instance-details',
        tokenExpiration: new Date(Date.now() + 3600 * 1000),
        deletedAt: null,
        refreshNeeded: false,
      },
      {
        id: 'integration-neighbour',
        organizationId: 'org-1',
        customerId: 'customer-2',
        name: 'Twitter Neighbour',
        providerIdentifier: 'x',
        token: 'neighbour-secret-token-789',
        refreshToken: 'neighbour-refresh-token-012',
        customInstanceDetails: 'neighbour-custom-details',
        tokenExpiration: new Date(Date.now() + 7200 * 1000),
        deletedAt: null,
        refreshNeeded: false,
      },
      {
        id: 'integration-other-org',
        organizationId: 'org-2',
        customerId: 'customer-3',
        name: 'Threads Other Org',
        providerIdentifier: 'threads',
        token: 'other-org-token-999',
        refreshToken: 'other-org-refresh-token-888',
        customInstanceDetails: null,
        tokenExpiration: new Date(Date.now() + 86400 * 1000),
        deletedAt: null,
        refreshNeeded: false,
      },
    ];

    mockCustomerDb = [
      { id: 'customer-1', orgId: 'org-1', name: 'Customer 1', deletedAt: null },
      { id: 'customer-2', orgId: 'org-1', name: 'Customer 2', deletedAt: null },
      { id: 'customer-3', orgId: 'org-2', name: 'Customer 3', deletedAt: null },
    ];

    const mockIntegrationPrisma: any = {
      model: {
        integration: {
          update: vi.fn(async ({ where, data }: any) => {
            const item = mockIntegrationDb.find(
              (i) => i.id === where.id && (!where.organizationId || i.organizationId === where.organizationId)
            );
            if (!item) throw new Error('Integration not found');
            Object.assign(item, data);
            return item;
          }),
          updateMany: vi.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const item of mockIntegrationDb) {
              const matchOrg = !where.organizationId || item.organizationId === where.organizationId;
              const matchCustomer = !where.customerId || item.customerId === where.customerId;
              if (matchOrg && matchCustomer) {
                Object.assign(item, data);
                count++;
              }
            }
            return { count };
          }),
        },
      },
    };

    const mockCustomerPrisma: any = {
      model: {
        customer: {
          update: vi.fn(async ({ where, data }: any) => {
            const item = mockCustomerDb.find((c) => c.id === where.id && c.orgId === where.orgId);
            if (!item) throw new Error('Customer not found');
            Object.assign(item, data);
            return item;
          }),
          updateMany: vi.fn(async ({ where, data }: any) => {
            let count = 0;
            for (const item of mockCustomerDb) {
              if (!where.orgId || item.orgId === where.orgId) {
                Object.assign(item, data);
                count++;
              }
            }
            return { count };
          }),
        },
      },
    };

    const mockEmptyPrisma: any = { model: {} };

    integrationRepo = new IntegrationRepository(
      mockIntegrationPrisma,
      mockEmptyPrisma, // _posts
      mockEmptyPrisma, // _plugs
      mockEmptyPrisma, // _exisingPlugData
      mockCustomerPrisma,
      mockEmptyPrisma  // _mentions
    );

    organizationRepo = new OrganizationRepository(
      mockEmptyPrisma, // _organization
      mockEmptyPrisma, // _userOrg
      mockEmptyPrisma, // _user
      mockIntegrationPrisma,
      mockCustomerPrisma
    );
  });

  describe('deleteChannel', () => {
    it('nulls token, refreshToken, customInstanceDetails, and tokenExpiration in the same write that sets deletedAt', async () => {
      await integrationRepo.deleteChannel('org-1', 'integration-target');

      const target = mockIntegrationDb.find((i) => i.id === 'integration-target');
      expect(target.deletedAt).toBeInstanceOf(Date);
      expect(target.token).toBeNull();
      expect(target.refreshToken).toBeNull();
      expect(target.customInstanceDetails).toBeNull();
      expect(target.tokenExpiration).toBeNull();

      // Untouched neighbouring integration keeps its tokens intact
      const neighbour = mockIntegrationDb.find((i) => i.id === 'integration-neighbour');
      expect(neighbour.deletedAt).toBeNull();
      expect(neighbour.token).toBe('neighbour-secret-token-789');
      expect(neighbour.refreshToken).toBe('neighbour-refresh-token-012');
      expect(neighbour.customInstanceDetails).toBe('neighbour-custom-details');

      // Other org integration is untouched
      const otherOrg = mockIntegrationDb.find((i) => i.id === 'integration-other-org');
      expect(otherOrg.token).toBe('other-org-token-999');
    });
  });

  describe('disconnectChannel', () => {
    it('nulls credentials and sets refreshNeeded=true while leaving neighbours untouched', async () => {
      await integrationRepo.disconnectChannel('org-1', 'integration-target');

      const target = mockIntegrationDb.find((i) => i.id === 'integration-target');
      expect(target.refreshNeeded).toBe(true);
      expect(target.token).toBeNull();
      expect(target.refreshToken).toBeNull();
      expect(target.customInstanceDetails).toBeNull();
      expect(target.tokenExpiration).toBeNull();

      // Neighbour keeps tokens
      const neighbour = mockIntegrationDb.find((i) => i.id === 'integration-neighbour');
      expect(neighbour.token).toBe('neighbour-secret-token-789');
      expect(neighbour.refreshToken).toBe('neighbour-refresh-token-012');
    });
  });

  describe('deleteCustomer', () => {
    it('soft-deletes customer and nulls credentials on all associated integrations', async () => {
      await integrationRepo.deleteCustomer('org-1', 'customer-1');

      const customer = mockCustomerDb.find((c) => c.id === 'customer-1');
      expect(customer.deletedAt).toBeInstanceOf(Date);

      const target = mockIntegrationDb.find((i) => i.id === 'integration-target');
      expect(target.deletedAt).toBeInstanceOf(Date);
      expect(target.token).toBeNull();
      expect(target.refreshToken).toBeNull();
      expect(target.customInstanceDetails).toBeNull();

      // Neighbouring customer 2 integration is untouched
      const neighbour = mockIntegrationDb.find((i) => i.id === 'integration-neighbour');
      expect(neighbour.deletedAt).toBeNull();
      expect(neighbour.token).toBe('neighbour-secret-token-789');

      // Customer 2 record is untouched
      const customer2 = mockCustomerDb.find((c) => c.id === 'customer-2');
      expect(customer2.deletedAt).toBeNull();
    });
  });

  describe('deleteOrganization', () => {
    it('soft-deletes all org customers and nulls credentials for all org integrations', async () => {
      await organizationRepo.deleteOrganization('org-1');

      // Both org-1 integrations are wiped
      const target = mockIntegrationDb.find((i) => i.id === 'integration-target');
      expect(target.deletedAt).toBeInstanceOf(Date);
      expect(target.token).toBeNull();
      expect(target.refreshToken).toBeNull();

      const neighbour = mockIntegrationDb.find((i) => i.id === 'integration-neighbour');
      expect(neighbour.deletedAt).toBeInstanceOf(Date);
      expect(neighbour.token).toBeNull();
      expect(neighbour.refreshToken).toBeNull();

      // Org-2 integration is completely untouched
      const otherOrg = mockIntegrationDb.find((i) => i.id === 'integration-other-org');
      expect(otherOrg.deletedAt).toBeNull();
      expect(otherOrg.token).toBe('other-org-token-999');
      expect(otherOrg.refreshToken).toBe('other-org-refresh-token-888');

      // Org-1 customers are soft-deleted; org-2 customer untouched
      expect(mockCustomerDb.find((c) => c.id === 'customer-1').deletedAt).toBeInstanceOf(Date);
      expect(mockCustomerDb.find((c) => c.id === 'customer-2').deletedAt).toBeInstanceOf(Date);
      expect(mockCustomerDb.find((c) => c.id === 'customer-3').deletedAt).toBeNull();
    });
  });
});
