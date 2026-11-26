import { Socket, io } from 'socket.io-client';
import React, { useCallback, useState, useEffect } from 'react';
// config
import { HOST_API_KEY } from 'config';
// store
import { useDispatch } from 'store/store';
import { logoutAction } from 'store/slices/auth';
import { updateBalance } from 'store/slices/balance';
// hooks
import { useAuth } from 'hooks/use-auth-context';
//
import { SocketContext } from './socket-context';

type SocketProviderProps = {
    children: React.ReactNode;
};

const SocketProvider = ({ children }: SocketProviderProps) => {
    const { isLogined, accessToken, logout } = useAuth();
    const dispatch = useDispatch();
    const [socket, setSocket] = useState<Socket | null>(null);

    const registerCallbacks = useCallback((socketInstance: Socket) => {
        if (socketInstance) {
            socketInstance.on('destory', (data) => {
                dispatch(logoutAction());
            });
            socketInstance.on('logout', (data) => {
                logout();
            });
            socketInstance.on('multi-login', (data) => {
                if (data.token === accessToken) {
                    dispatch(logoutAction());
                }
            });
            socketInstance.on('balance', (data) => {
                dispatch(updateBalance(data));
            });
            socketInstance.on('notification', (data) => {
                console.log('--notification---', data);
            });
        }
    }, []);

    const cleanUp = () => {
        setSocket(null);
    };

    const connect = (token: string) => {
        if (!HOST_API_KEY) {
            return null;
        }
        const socketInit: Socket = io(String(HOST_API_KEY), {
            transports: ['websocket'],
            upgrade: false,
            query: { auth: token }
        });
        registerCallbacks(socketInit);
        setSocket(socketInit);
        return socketInit;
    };

    useEffect(() => {
        connect(accessToken ?? '');
        return () => cleanUp();
        // eslint-disable-next-line
    }, [isLogined, accessToken]);

    return <SocketContext.Provider value={{ socket }}> {children}</SocketContext.Provider>;
};

export default SocketProvider;
