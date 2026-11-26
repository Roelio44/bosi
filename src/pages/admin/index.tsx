import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Box,
    Button,
    Card,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    Grid,
    IconButton,
    InputAdornment,
    MenuItem,
    Paper,
    Stack,
    Switch,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Tabs,
    TextField,
    Typography
} from '@mui/material';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import CasinoOutlinedIcon from '@mui/icons-material/CasinoOutlined';
import SportsSoccerOutlinedIcon from '@mui/icons-material/SportsSoccerOutlined';
import ViewCarouselOutlinedIcon from '@mui/icons-material/ViewCarouselOutlined';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import { useSnackbar } from 'notistack';
import { adminApi, AdminOverview, AdminProvider, AdminStatus, AdminUser, getAdminToken } from 'api/admin.api';
import { dispatch } from 'store/store';
import { updateBanner } from 'store/slices/setting';

export default function AdminPanel() {
    const { enqueueSnackbar } = useSnackbar();

    const [status, setStatus] = useState<AdminStatus | null>(null);
    const [authenticated, setAuthenticated] = useState<boolean>(Boolean(getAdminToken()));
    const [loadingAuth, setLoadingAuth] = useState<boolean>(true);
    const [passcode, setPasscode] = useState<string>('');
    const [confirmPasscode, setConfirmPasscode] = useState<string>('');
    const [submittingAuth, setSubmittingAuth] = useState<boolean>(false);

    const [activeTab, setActiveTab] = useState<number>(0);
    const [overview, setOverview] = useState<AdminOverview | null>(null);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [providers, setProviders] = useState<AdminProvider[]>([]);
    const [sportsbook, setSportsbook] = useState<{ enabled: boolean; title: string; currency: string[] }>({
        enabled: true,
        title: 'Nexustrike Sportsbook',
        currency: ['USD', 'EUR', 'BRL']
    });
    const [banners, setBanners] = useState<{ image: string; order: number }[]>([]);
    const [bonuses, setBonuses] = useState<any[]>([]);
    const [refreshing, setRefreshing] = useState<boolean>(false);

    const [userSearch, setUserSearch] = useState<string>('');
    const [providerTypeFilter, setProviderTypeFilter] = useState<string>('ALL');

    // Modals
    const [createUserOpen, setCreateUserOpen] = useState<boolean>(false);
    const [newUser, setNewUser] = useState({
        username: '',
        email: '',
        password: '',
        currency: 'USD',
        balance: '1000'
    });

    const [balanceDialogUser, setBalanceDialogUser] = useState<AdminUser | null>(null);
    const [balanceMode, setBalanceMode] = useState<'credit' | 'debit' | 'set'>('credit');
    const [balanceAmount, setBalanceAmount] = useState<string>('500');

    const [newBannerUrl, setNewBannerUrl] = useState<string>('');
    const [newBonus, setNewBonus] = useState({
        name: '',
        percent: '100',
        bonusCap: '2000',
        expireDays: '30',
        banner: '/assets/images/home/players-banner.png',
        description: ''
    });

    const checkAuthStatus = useCallback(async () => {
        try {
            setLoadingAuth(true);
            const data = await adminApi.getStatus();
            setStatus(data);
            setAuthenticated(Boolean(data.authenticated && getAdminToken()));
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Unable to check admin status', { variant: 'error' });
        } finally {
            setLoadingAuth(false);
        }
    }, [enqueueSnackbar]);

    const loadAllData = useCallback(async () => {
        try {
            setRefreshing(true);
            const [ov, usr, provData, ban, bon] = await Promise.all([
                adminApi.getOverview(),
                adminApi.getUsers(),
                adminApi.getProviders(),
                adminApi.getBanners(),
                adminApi.getBonuses()
            ]);
            setOverview(ov);
            setUsers(usr);
            setProviders(provData.providers);
            setSportsbook(provData.sportsbook);
            setBanners(ban);
            setBonuses(bon);
            dispatch(updateBanner({ banners: ban }));
        } catch (err: any) {
            if (err?.message?.toLowerCase().includes('admin authentication')) {
                adminApi.logout();
                setAuthenticated(false);
            } else {
                enqueueSnackbar(err?.message || 'Failed to load admin data', { variant: 'error' });
            }
        } finally {
            setRefreshing(false);
        }
    }, [enqueueSnackbar]);

    useEffect(() => {
        checkAuthStatus();
    }, [checkAuthStatus]);

    useEffect(() => {
        if (authenticated) {
            loadAllData();
        }
    }, [authenticated, loadAllData]);

    const needsClaim = Boolean(status && !status.envConfigured && !status.claimed);

    const handleAuthSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (needsClaim) {
            if (passcode.length < 8) {
                enqueueSnackbar('Admin passcode must be at least 8 characters', { variant: 'warning' });
                return;
            }
            if (passcode !== confirmPasscode) {
                enqueueSnackbar('Passcodes do not match', { variant: 'warning' });
                return;
            }
        }
        try {
            setSubmittingAuth(true);
            if (needsClaim) {
                await adminApi.claim(passcode);
                enqueueSnackbar('Admin passcode configured and unlocked', { variant: 'success' });
            } else {
                await adminApi.login(passcode);
                enqueueSnackbar('Signed in to Admin Panel', { variant: 'success' });
            }
            setPasscode('');
            setConfirmPasscode('');
            setAuthenticated(true);
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Authentication failed', { variant: 'error' });
        } finally {
            setSubmittingAuth(false);
        }
    };

    const handleLogout = () => {
        adminApi.logout();
        setAuthenticated(false);
        checkAuthStatus();
    };

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await adminApi.createUser({
                username: newUser.username.trim(),
                email: newUser.email.trim(),
                password: newUser.password,
                currency: newUser.currency,
                balance: Number(newUser.balance) || 0
            });
            enqueueSnackbar(`Player "${newUser.username}" created`, { variant: 'success' });
            setCreateUserOpen(false);
            setNewUser({ username: '', email: '', password: '', currency: 'USD', balance: '1000' });
            loadAllData();
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to create player', { variant: 'error' });
        }
    };

    const handleAdjustBalance = async (userId: string, mode: 'credit' | 'debit' | 'set', amount: number) => {
        try {
            await adminApi.updateUserBalance(userId, mode, amount);
            enqueueSnackbar('Player balance updated', { variant: 'success' });
            setBalanceDialogUser(null);
            loadAllData();
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to update balance', { variant: 'error' });
        }
    };

    const handleToggleKyc = async (user: AdminUser) => {
        try {
            await adminApi.updateUserKyc(user._id, !user.kyc);
            enqueueSnackbar(`Updated KYC for ${user.username}`, { variant: 'success' });
            loadAllData();
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to update KYC', { variant: 'error' });
        }
    };

    const handleToggleProvider = async (provider: AdminProvider) => {
        try {
            await adminApi.toggleProvider(provider.code, !provider.enabled);
            setProviders((prev) =>
                prev.map((p) => (p.code === provider.code ? { ...p, enabled: !p.enabled } : p))
            );
            enqueueSnackbar(`${provider.name} ${!provider.enabled ? 'enabled' : 'disabled'}`, {
                variant: 'success'
            });
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to update provider', { variant: 'error' });
        }
    };

    const handleToggleSportsbook = async (enabled: boolean) => {
        try {
            const updated = await adminApi.updateSportsbook({ enabled });
            setSportsbook(updated);
            enqueueSnackbar(`Sportsbook ${enabled ? 'enabled' : 'paused'}`, { variant: 'success' });
            loadAllData();
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to update sportsbook', { variant: 'error' });
        }
    };

    const handleRefreshCatalog = async () => {
        try {
            setRefreshing(true);
            const res = await adminApi.refreshCache();
            enqueueSnackbar(`Synced ${res.providersCount} NexusGGR providers`, { variant: 'success' });
            await loadAllData();
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to refresh catalog', { variant: 'error' });
        } finally {
            setRefreshing(false);
        }
    };

    const handleAddBanner = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const updated = await adminApi.addBanner(newBannerUrl);
            setBanners(updated);
            dispatch(updateBanner({ banners: updated }));
            setNewBannerUrl('');
            enqueueSnackbar('Banner added', { variant: 'success' });
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Invalid banner URL', { variant: 'error' });
        }
    };

    const handleDeleteBanner = async (index: number) => {
        try {
            const updated = await adminApi.deleteBanner(index);
            setBanners(updated);
            dispatch(updateBanner({ banners: updated }));
            enqueueSnackbar('Banner removed', { variant: 'success' });
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to delete banner', { variant: 'error' });
        }
    };

    const handleCreateBonus = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await adminApi.createBonus({
                name: newBonus.name,
                percent: Number(newBonus.percent),
                bonusCap: Number(newBonus.bonusCap),
                expireDays: Number(newBonus.expireDays),
                banner: newBonus.banner,
                description: newBonus.description
            });
            enqueueSnackbar('Promotion published to /bonus', { variant: 'success' });
            setNewBonus({
                name: '',
                percent: '100',
                bonusCap: '2000',
                expireDays: '30',
                banner: '/assets/images/home/players-banner.png',
                description: ''
            });
            loadAllData();
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to create bonus', { variant: 'error' });
        }
    };

    const handleDeleteBonus = async (id: string) => {
        try {
            await adminApi.deleteBonus(id);
            enqueueSnackbar('Promotion deleted', { variant: 'success' });
            loadAllData();
        } catch (err: any) {
            enqueueSnackbar(err?.message || 'Failed to delete promotion', { variant: 'error' });
        }
    };

    const filteredUsers = useMemo(() => {
        const q = userSearch.trim().toLowerCase();
        if (!q) return users;
        return users.filter(
            (u) =>
                u.username.toLowerCase().includes(q) ||
                u.email.toLowerCase().includes(q) ||
                u.currency.toLowerCase().includes(q)
        );
    }, [users, userSearch]);

    const filteredProviders = useMemo(() => {
        if (providerTypeFilter === 'ALL') return providers;
        return providers.filter((p) => p.type === providerTypeFilter);
    }, [providers, providerTypeFilter]);

    if (loadingAuth) {
        return (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '60vh' }}>
                <Typography color="text.secondary">Checking admin access...</Typography>
            </Stack>
        );
    }

    if (!authenticated) {
        return (
            <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '72vh', py: 4 }}>
                <Card
                    sx={{
                        width: '100%',
                        maxWidth: 440,
                        p: 4,
                        borderRadius: 3,
                        bgcolor: 'background.layer2',
                        border: '1px solid',
                        borderColor: 'divider'
                    }}
                >
                    <Stack spacing={2.5} component="form" onSubmit={handleAuthSubmit}>
                        <Stack direction="row" alignItems="center" spacing={1.5}>
                            <Box
                                sx={{
                                    width: 44,
                                    height: 44,
                                    borderRadius: 2,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    bgcolor: 'rgba(36, 238, 137, 0.14)',
                                    color: 'primary.main'
                                }}
                            >
                                <LockOutlinedIcon />
                            </Box>
                            <Box>
                                <Typography variant="h5" fontWeight={700}>
                                    {needsClaim ? 'Claim Admin Access' : 'Admin Panel'}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {needsClaim
                                        ? 'Set the initial administrator passcode to unlock controls.'
                                        : 'Enter your administrator passcode to manage the platform.'}
                                </Typography>
                            </Box>
                        </Stack>

                        <TextField
                            fullWidth
                            type="password"
                            label={needsClaim ? 'New Admin Passcode (8+ characters)' : 'Admin Passcode'}
                            value={passcode}
                            onChange={(e) => setPasscode(e.target.value)}
                            autoComplete={needsClaim ? 'new-password' : 'current-password'}
                            required
                        />

                        {needsClaim && (
                            <TextField
                                fullWidth
                                type="password"
                                label="Confirm Admin Passcode"
                                value={confirmPasscode}
                                onChange={(e) => setConfirmPasscode(e.target.value)}
                                autoComplete="new-password"
                                required
                            />
                        )}

                        <Button
                            type="submit"
                            variant="contained"
                            size="large"
                            disabled={submittingAuth}
                            sx={{ fontWeight: 700, py: 1.25 }}
                        >
                            {submittingAuth
                                ? 'Verifying...'
                                : needsClaim
                                  ? 'Set Admin Passcode & Enter'
                                  : 'Unlock Admin Panel'}
                        </Button>
                    </Stack>
                </Card>
            </Stack>
        );
    }

    return (
        <Stack spacing={3} sx={{ pb: 6 }}>
            {/* Header Bar */}
            <Paper
                sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    bgcolor: 'background.layer2',
                    border: '1px solid',
                    borderColor: 'divider'
                }}
            >
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    justifyContent="space-between"
                    spacing={2}
                >
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                        <Box
                            sx={{
                                width: 42,
                                height: 42,
                                borderRadius: 2,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                bgcolor: 'rgba(36, 238, 137, 0.14)',
                                color: 'primary.main'
                            }}
                        >
                            <AdminPanelSettingsOutlinedIcon />
                        </Box>
                        <Box>
                            <Typography variant="h5" fontWeight={700}>
                                Betthrob Admin Console
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Live control over players, balances, NexusGGR game providers, sportsbook, and promotions
                            </Typography>
                        </Box>
                    </Stack>

                    <Stack direction="row" spacing={1}>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<RefreshIcon />}
                            onClick={loadAllData}
                            disabled={refreshing}
                        >
                            {refreshing ? 'Syncing...' : 'Sync'}
                        </Button>
                        <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            startIcon={<LogoutIcon />}
                            onClick={handleLogout}
                        >
                            Lock
                        </Button>
                    </Stack>
                </Stack>

                <Divider sx={{ my: 2 }} />

                <Tabs
                    value={activeTab}
                    onChange={(_, val) => setActiveTab(val)}
                    variant="scrollable"
                    scrollButtons="auto"
                >
                    <Tab icon={<DashboardOutlinedIcon fontSize="small" />} iconPosition="start" label="Overview" />
                    <Tab icon={<PeopleOutlineIcon fontSize="small" />} iconPosition="start" label={`Players (${users.length})`} />
                    <Tab
                        icon={<CasinoOutlinedIcon fontSize="small" />}
                        iconPosition="start"
                        label={`Providers (${providers.length})`}
                    />
                    <Tab
                        icon={<ViewCarouselOutlinedIcon fontSize="small" />}
                        iconPosition="start"
                        label="Banners & Bonuses"
                    />
                </Tabs>
            </Paper>

            {/* Tab 0: Overview */}
            {activeTab === 0 && (
                <Stack spacing={3}>
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="body2" color="text.secondary">
                                        Registered Players
                                    </Typography>
                                    <PeopleOutlineIcon color="primary" fontSize="small" />
                                </Stack>
                                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                                    {overview?.totalUsers ?? 0}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    Active session accounts
                                </Typography>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="body2" color="text.secondary">
                                        Total Player Balances
                                    </Typography>
                                    <AccountBalanceWalletOutlinedIcon color="primary" fontSize="small" />
                                </Stack>
                                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                                    ${Number(overview?.totalBalance ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    Across all player wallets
                                </Typography>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="body2" color="text.secondary">
                                        Active Providers
                                    </Typography>
                                    <CasinoOutlinedIcon color="primary" fontSize="small" />
                                </Stack>
                                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                                    {overview?.activeProviders ?? 0} / {overview?.totalProviders ?? 0}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {overview?.cachedGamesCount ?? 0} cached games loaded
                                </Typography>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                            <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="body2" color="text.secondary">
                                        Sportsbook & Promos
                                    </Typography>
                                    <SportsSoccerOutlinedIcon color="primary" fontSize="small" />
                                </Stack>
                                <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
                                    {overview?.sportsbookEnabled ? 'Live' : 'Paused'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {overview?.bannersCount ?? 0} banners · {overview?.bonusesCount ?? 0} bonuses
                                </Typography>
                            </Card>
                        </Grid>
                    </Grid>

                    <Card sx={{ p: 3, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="h6" fontWeight={700} gutterBottom>
                            Quick Platform Controls
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mt: 2 }}>
                            <Button variant="contained" startIcon={<RefreshIcon />} onClick={handleRefreshCatalog} disabled={refreshing}>
                                Refresh NexusGGR Game Catalog
                            </Button>
                            <Button
                                variant="outlined"
                                color={sportsbook.enabled ? 'warning' : 'success'}
                                onClick={() => handleToggleSportsbook(!sportsbook.enabled)}
                            >
                                {sportsbook.enabled ? 'Pause Sportsbook' : 'Resume Sportsbook'}
                            </Button>
                            <Button variant="outlined" startIcon={<AddIcon />} onClick={() => { setActiveTab(1); setCreateUserOpen(true); }}>
                                Create Demo Player
                            </Button>
                        </Stack>
                    </Card>
                </Stack>
            )}

            {/* Tab 1: Players & Balances */}
            {activeTab === 1 && (
                <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        justifyContent="space-between"
                        alignItems={{ xs: 'stretch', sm: 'center' }}
                        spacing={2}
                        sx={{ mb: 2 }}
                    >
                        <TextField
                            size="small"
                            placeholder="Search players by username, email, or currency..."
                            value={userSearch}
                            onChange={(e) => setUserSearch(e.target.value)}
                            sx={{ minWidth: { sm: 320 } }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                )
                            }}
                        />
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateUserOpen(true)}>
                            Create Demo Player
                        </Button>
                    </Stack>

                    <TableContainer>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>Username</TableCell>
                                    <TableCell>Email</TableCell>
                                    <TableCell>Currency</TableCell>
                                    <TableCell align="right">Balance</TableCell>
                                    <TableCell align="center">KYC</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {filteredUsers.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                            <Typography color="text.secondary">
                                                No registered players yet. Create a demo player or sign up via the main app.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredUsers.map((u) => (
                                        <TableRow key={u._id} hover>
                                            <TableCell>
                                                <Typography fontWeight={600}>{u.username}</Typography>
                                            </TableCell>
                                            <TableCell>{u.email}</TableCell>
                                            <TableCell>
                                                <Chip label={u.currency} size="small" />
                                            </TableCell>
                                            <TableCell align="right">
                                                <Typography fontWeight={700} color="primary.main">
                                                    {Number(u.balance).toFixed(2)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center">
                                                <Switch checked={Boolean(u.kyc)} onChange={() => handleToggleKyc(u)} size="small" />
                                            </TableCell>
                                            <TableCell align="right">
                                                <Stack direction="row" spacing={1} justifyContent="flex-end">
                                                    <Button
                                                        size="small"
                                                        variant="outlined"
                                                        onClick={() => handleAdjustBalance(u._id, 'credit', 500)}
                                                    >
                                                        +$500
                                                    </Button>
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        onClick={() => {
                                                            setBalanceDialogUser(u);
                                                            setBalanceMode('credit');
                                                            setBalanceAmount('500');
                                                        }}
                                                    >
                                                        Adjust
                                                    </Button>
                                                </Stack>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Card>
            )}

            {/* Tab 2: Providers & Sportsbook */}
            {activeTab === 2 && (
                <Stack spacing={2.5}>
                    <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} justifyContent="space-between" spacing={2}>
                            <Stack direction="row" alignItems="center" spacing={1.5}>
                                <SportsSoccerOutlinedIcon color="primary" />
                                <Box>
                                    <Typography variant="subtitle1" fontWeight={700}>
                                        {sportsbook.title}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        Control public availability on /sports and sportsbook launch endpoint
                                    </Typography>
                                </Box>
                            </Stack>
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <Chip
                                    label={sportsbook.enabled ? 'Active' : 'Paused'}
                                    color={sportsbook.enabled ? 'success' : 'warning'}
                                    size="small"
                                />
                                <Switch
                                    checked={sportsbook.enabled}
                                    onChange={(e) => handleToggleSportsbook(e.target.checked)}
                                />
                            </Stack>
                        </Stack>
                    </Card>

                    <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            justifyContent="space-between"
                            alignItems={{ sm: 'center' }}
                            spacing={2}
                            sx={{ mb: 2 }}
                        >
                            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {['ALL', 'slot', 'live', 'FH', 'MN', 'LT', 'SB'].map((cat) => (
                                    <Button
                                        key={cat}
                                        size="small"
                                        variant={providerTypeFilter === cat ? 'contained' : 'outlined'}
                                        onClick={() => setProviderTypeFilter(cat)}
                                    >
                                        {cat === 'ALL' ? 'All' : cat.toUpperCase()}
                                    </Button>
                                ))}
                            </Stack>
                            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={handleRefreshCatalog}>
                                Refresh NexusGGR Cache
                            </Button>
                        </Stack>

                        <TableContainer>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Provider</TableCell>
                                        <TableCell>Code</TableCell>
                                        <TableCell>Type</TableCell>
                                        <TableCell align="right">Games</TableCell>
                                        <TableCell align="right">Enabled</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {filteredProviders.map((provider) => (
                                        <TableRow key={provider.code} hover>
                                            <TableCell>
                                                <Typography fontWeight={600}>{provider.name}</Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Chip label={provider.code} size="small" variant="outlined" />
                                            </TableCell>
                                            <TableCell>{provider.type.toUpperCase()}</TableCell>
                                            <TableCell align="right">{provider.games ?? 'Live'}</TableCell>
                                            <TableCell align="right">
                                                <Switch
                                                    checked={provider.enabled}
                                                    onChange={() => handleToggleProvider(provider)}
                                                    size="small"
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Card>
                </Stack>
            )}

            {/* Tab 3: Banners & Bonuses */}
            {activeTab === 3 && (
                <Grid container spacing={2.5}>
                    <Grid size={{ xs: 12, md: 6 }}>
                        <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                                <ViewCarouselOutlinedIcon color="primary" />
                                <Typography variant="h6" fontWeight={700}>
                                    Home Banners ({banners.length})
                                </Typography>
                            </Stack>

                            <Stack component="form" onSubmit={handleAddBanner} direction="row" spacing={1} sx={{ mb: 2.5 }}>
                                <TextField
                                    fullWidth
                                    size="small"
                                    label="Banner image URL (/assets/... or https://...)"
                                    value={newBannerUrl}
                                    onChange={(e) => setNewBannerUrl(e.target.value)}
                                    required
                                />
                                <Button type="submit" variant="contained" startIcon={<AddIcon />}>
                                    Add
                                </Button>
                            </Stack>

                            <Stack spacing={1.5}>
                                {banners.map((b, idx) => (
                                    <Paper
                                        key={`${b.image}-${idx}`}
                                        sx={{
                                            p: 1.5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 1.5,
                                            bgcolor: 'background.layer3'
                                        }}
                                    >
                                        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                                            {b.image ? (
                                                <Box
                                                    component="img"
                                                    src={b.image}
                                                    alt={`Banner ${idx + 1}`}
                                                    sx={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 1 }}
                                                />
                                            ) : null}
                                            <Typography variant="body2" noWrap>
                                                {b.image}
                                            </Typography>
                                        </Stack>
                                        <IconButton color="error" size="small" onClick={() => handleDeleteBanner(idx)}>
                                            <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                    </Paper>
                                ))}
                            </Stack>
                        </Card>
                    </Grid>

                    <Grid size={{ xs: 12, md: 6 }}>
                        <Card sx={{ p: 2.5, borderRadius: 2, bgcolor: 'background.layer2', border: '1px solid', borderColor: 'divider' }}>
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                                <CardGiftcardOutlinedIcon color="primary" />
                                <Typography variant="h6" fontWeight={700}>
                                    Promotions & Bonuses ({bonuses.length})
                                </Typography>
                            </Stack>

                            <Stack component="form" onSubmit={handleCreateBonus} spacing={1.5} sx={{ mb: 2.5 }}>
                                <TextField
                                    size="small"
                                    label="Promotion Title"
                                    value={newBonus.name}
                                    onChange={(e) => setNewBonus((p) => ({ ...p, name: e.target.value }))}
                                    required
                                />
                                <Stack direction="row" spacing={1.5}>
                                    <TextField
                                        size="small"
                                        type="number"
                                        label="Match %"
                                        value={newBonus.percent}
                                        onChange={(e) => setNewBonus((p) => ({ ...p, percent: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        size="small"
                                        type="number"
                                        label="Max Cap ($)"
                                        value={newBonus.bonusCap}
                                        onChange={(e) => setNewBonus((p) => ({ ...p, bonusCap: e.target.value }))}
                                        fullWidth
                                    />
                                    <TextField
                                        size="small"
                                        type="number"
                                        label="Days Valid"
                                        value={newBonus.expireDays}
                                        onChange={(e) => setNewBonus((p) => ({ ...p, expireDays: e.target.value }))}
                                        fullWidth
                                    />
                                </Stack>
                                <TextField
                                    size="small"
                                    label="Banner Image URL"
                                    value={newBonus.banner}
                                    onChange={(e) => setNewBonus((p) => ({ ...p, banner: e.target.value }))}
                                    required
                                />
                                <TextField
                                    size="small"
                                    multiline
                                    rows={2}
                                    label="Description"
                                    value={newBonus.description}
                                    onChange={(e) => setNewBonus((p) => ({ ...p, description: e.target.value }))}
                                />
                                <Button type="submit" variant="contained" startIcon={<AddIcon />}>
                                    Publish Promotion
                                </Button>
                            </Stack>

                            <Stack spacing={1.5}>
                                {bonuses.map((bon) => (
                                    <Paper
                                        key={bon._id}
                                        sx={{
                                            p: 1.5,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            bgcolor: 'background.layer3'
                                        }}
                                    >
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="subtitle2" fontWeight={700} noWrap>
                                                {bon.name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {bon.percent}% up to ${bon.bonusCap}
                                            </Typography>
                                        </Box>
                                        <IconButton color="error" size="small" onClick={() => handleDeleteBonus(bon._id)}>
                                            <DeleteOutlineIcon fontSize="small" />
                                        </IconButton>
                                    </Paper>
                                ))}
                            </Stack>
                        </Card>
                    </Grid>
                </Grid>
            )}

            {/* Create Demo User Dialog */}
            <Dialog open={createUserOpen} onClose={() => setCreateUserOpen(false)} maxWidth="xs" fullWidth>
                <form onSubmit={handleCreateUser}>
                    <DialogTitle>Create Demo Player</DialogTitle>
                    <DialogContent>
                        <Stack spacing={2} sx={{ pt: 1 }}>
                            <TextField
                                label="Username (min 4 chars)"
                                value={newUser.username}
                                onChange={(e) => setNewUser((p) => ({ ...p, username: e.target.value }))}
                                required
                                fullWidth
                            />
                            <TextField
                                type="email"
                                label="Email"
                                value={newUser.email}
                                onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                                required
                                fullWidth
                            />
                            <TextField
                                type="password"
                                label="Password (min 6 chars)"
                                value={newUser.password}
                                onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                                required
                                fullWidth
                            />
                            <Stack direction="row" spacing={1.5}>
                                <TextField
                                    select
                                    label="Currency"
                                    value={newUser.currency}
                                    onChange={(e) => setNewUser((p) => ({ ...p, currency: e.target.value }))}
                                    fullWidth
                                >
                                    {['USD', 'EUR', 'BRL'].map((c) => (
                                        <MenuItem key={c} value={c}>
                                            {c}
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <TextField
                                    type="number"
                                    label="Initial Balance"
                                    value={newUser.balance}
                                    onChange={(e) => setNewUser((p) => ({ ...p, balance: e.target.value }))}
                                    fullWidth
                                />
                            </Stack>
                        </Stack>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setCreateUserOpen(false)}>Cancel</Button>
                        <Button type="submit" variant="contained">
                            Create Player
                        </Button>
                    </DialogActions>
                </form>
            </Dialog>

            {/* Adjust Balance Dialog */}
            <Dialog open={Boolean(balanceDialogUser)} onClose={() => setBalanceDialogUser(null)} maxWidth="xs" fullWidth>
                <DialogTitle>Adjust Balance: {balanceDialogUser?.username}</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            select
                            label="Operation"
                            value={balanceMode}
                            onChange={(e) => setBalanceMode(e.target.value as 'credit' | 'debit' | 'set')}
                            fullWidth
                        >
                            <MenuItem value="credit">Credit (+ Add Funds)</MenuItem>
                            <MenuItem value="debit">Debit (- Subtract Funds)</MenuItem>
                            <MenuItem value="set">Set Exact Balance</MenuItem>
                        </TextField>
                        <TextField
                            type="number"
                            label="Amount"
                            value={balanceAmount}
                            onChange={(e) => setBalanceAmount(e.target.value)}
                            fullWidth
                        />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBalanceDialogUser(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={() =>
                            balanceDialogUser &&
                            handleAdjustBalance(balanceDialogUser._id, balanceMode, Number(balanceAmount) || 0)
                        }
                    >
                        Apply
                    </Button>
                </DialogActions>
            </Dialog>
        </Stack>
    );
}
