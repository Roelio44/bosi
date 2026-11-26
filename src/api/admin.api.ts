import axiosInstance from 'utils/axios';

let inMemoryAdminToken: string | null = null;

export const getAdminToken = () => inMemoryAdminToken;

export const setAdminToken = (token: string | null) => {
    inMemoryAdminToken = token;
};

const adminHeaders = () =>
    inMemoryAdminToken
        ? {
              Authorization: `Bearer ${inMemoryAdminToken}`
          }
        : {};

export interface AdminStatus {
    envConfigured: boolean;
    claimed: boolean;
    authenticated: boolean;
}

export interface AdminOverview {
    totalUsers: number;
    totalBalance: number;
    totalProviders: number;
    activeProviders: number;
    disabledProvidersCount: number;
    cachedGamesCount: number;
    sportsbookEnabled: boolean;
    bannersCount: number;
    bonusesCount: number;
}

export interface AdminUser {
    _id: string;
    username: string;
    name: string;
    email: string;
    currency: string;
    balance: number;
    kyc: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface AdminProvider {
    code: string;
    name: string;
    type: string;
    status: number;
    games: number | null;
    enabled: boolean;
}

export const adminApi = {
    getStatus: async (): Promise<AdminStatus> => {
        const res = await axiosInstance.get('/api/admin/status', { headers: adminHeaders() });
        return res.data;
    },
    claim: async (password: string): Promise<{ accessToken: string }> => {
        const res = await axiosInstance.post('/api/admin/claim', { password });
        if (res.data?.accessToken) {
            setAdminToken(res.data.accessToken);
        }
        return res.data;
    },
    login: async (password: string): Promise<{ accessToken: string }> => {
        const res = await axiosInstance.post('/api/admin/login', { password });
        if (res.data?.accessToken) {
            setAdminToken(res.data.accessToken);
        }
        return res.data;
    },
    logout: () => {
        setAdminToken(null);
    },
    getOverview: async (): Promise<AdminOverview> => {
        const res = await axiosInstance.get('/api/admin/overview', { headers: adminHeaders() });
        return res.data;
    },
    getUsers: async (): Promise<AdminUser[]> => {
        const res = await axiosInstance.get('/api/admin/users', { headers: adminHeaders() });
        return res.data;
    },
    createUser: async (payload: {
        username: string;
        email: string;
        password: string;
        currency: string;
        balance: number;
    }): Promise<AdminUser> => {
        const res = await axiosInstance.post('/api/admin/users', payload, { headers: adminHeaders() });
        return res.data;
    },
    updateUserBalance: async (
        userId: string,
        mode: 'set' | 'credit' | 'debit',
        amount: number
    ): Promise<AdminUser> => {
        const res = await axiosInstance.patch(
            `/api/admin/users/${userId}/balance`,
            { mode, amount },
            { headers: adminHeaders() }
        );
        return res.data;
    },
    updateUserKyc: async (userId: string, kyc: boolean): Promise<AdminUser> => {
        const res = await axiosInstance.patch(
            `/api/admin/users/${userId}/kyc`,
            { kyc },
            { headers: adminHeaders() }
        );
        return res.data;
    },
    getProviders: async (): Promise<{
        providers: AdminProvider[];
        sportsbook: { enabled: boolean; title: string; currency: string[] };
    }> => {
        const res = await axiosInstance.get('/api/admin/providers', { headers: adminHeaders() });
        return res.data;
    },
    toggleProvider: async (code: string, enabled: boolean) => {
        const res = await axiosInstance.patch(
            `/api/admin/providers/${encodeURIComponent(code)}`,
            { enabled },
            { headers: adminHeaders() }
        );
        return res.data;
    },
    updateSportsbook: async (payload: { enabled?: boolean; title?: string }) => {
        const res = await axiosInstance.patch('/api/admin/sportsbook', payload, { headers: adminHeaders() });
        return res.data;
    },
    refreshCache: async () => {
        const res = await axiosInstance.post('/api/admin/cache/refresh', {}, { headers: adminHeaders() });
        return res.data;
    },
    getBanners: async (): Promise<{ image: string; order: number }[]> => {
        const res = await axiosInstance.get('/api/admin/banners', { headers: adminHeaders() });
        return res.data;
    },
    addBanner: async (image: string) => {
        const res = await axiosInstance.post('/api/admin/banners', { image }, { headers: adminHeaders() });
        return res.data;
    },
    deleteBanner: async (index: number) => {
        const res = await axiosInstance.delete(`/api/admin/banners/${index}`, { headers: adminHeaders() });
        return res.data;
    },
    getBonuses: async () => {
        const res = await axiosInstance.get('/api/admin/bonuses', { headers: adminHeaders() });
        return res.data;
    },
    createBonus: async (payload: {
        name: string;
        percent: number;
        bonusCap: number;
        expireDays: number;
        banner: string;
        description: string;
    }) => {
        const res = await axiosInstance.post('/api/admin/bonuses', payload, { headers: adminHeaders() });
        return res.data;
    },
    deleteBonus: async (id: string) => {
        const res = await axiosInstance.delete(`/api/admin/bonuses/${encodeURIComponent(id)}`, {
            headers: adminHeaders()
        });
        return res.data;
    }
};
