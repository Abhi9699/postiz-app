import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntegrationRepository } from '../integration.repository';

describe('G1 Postiz Fork Credential Erasure on Delete (§A #90)', () => {
  let mockIntegrationDb: any[];
  let integrationRepo: IntegrationRepository;

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
        },
      },
    };

    const mockEmptyPrisma: any = { model: {} };

    integrationRepo = new IntegrationRepository(
      mockIntegrationPrisma,
      mockEmptyPrisma, // _posts
      mockEmptyPrisma, // _plugs
      mockEmptyPrisma, // _exisingPlugData
      mockEmptyPrisma, // _customer
      mockEmptyPrisma  // _mentions
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
      expect(otherOrg.refreshToken).toBe('other-org-refresh-token-888');
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

      // Untouched neighbouring integration keeps its tokens intact
      const neighbour = mockIntegrationDb.find((i) => i.id === 'integration-neighbour');
      expect(neighbour.token).toBe('neighbour-secret-token-789');
      expect(neighbour.refreshToken).toBe('neighbour-refresh-token-012');
      expect(neighbour.customInstanceDetails).toBe('neighbour-custom-details');

      // Other org integration is untouched
      const otherOrg = mockIntegrationDb.find((i) => i.id === 'integration-other-org');
      expect(otherOrg.token).toBe('other-org-token-999');
      expect(otherOrg.refreshToken).toBe('other-org-refresh-token-888');
    });
  });
});
