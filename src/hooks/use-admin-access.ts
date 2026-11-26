import { useEffect, useState } from 'react';
import { getAdminToken, subscribeAdminToken } from 'api/admin.api';
import { useAuth } from './use-auth-context';

export function useAdminAccess(): boolean {
    const { isLogined, user } = useAuth();
    const [hasPasscodeSession, setHasPasscodeSession] = useState<boolean>(() => Boolean(getAdminToken()));

    useEffect(() => {
        setHasPasscodeSession(Boolean(getAdminToken()));
        return subscribeAdminToken(() => {
            setHasPasscodeSession(Boolean(getAdminToken()));
        });
    }, []);

    return Boolean((isLogined && user?.role === 'admin') || hasPasscodeSession);
}
