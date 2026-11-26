// utils
import axios from './axios';

// ----------------------------------------------------------------------

// function jwtDecode(token: string) {
//     const base64Url = token.split('.')[1];
//     const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
//     const jsonPayload = decodeURIComponent(
//         window
//             .atob(base64)
//             .split('')
//             .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
//             .join('')
//     );

//     return JSON.parse(jsonPayload);
// }

// ----------------------------------------------------------------------

let inMemoryToken: string | null = null;

export const getSession = () => inMemoryToken;

export const isValidToken = (accessToken: string) => {
    if (!accessToken) {
        return false;
    }

    return true;
};

// ----------------------------------------------------------------------

export const tokenExpired = (exp: number) => {
    const currentTime = Date.now();
    const timeLeft = exp * 1000 - currentTime;

    const expiredTimer = setTimeout(() => {
        setSession(null);
    }, timeLeft);
    return expiredTimer;
};

// ----------------------------------------------------------------------

export const setSession = (accessToken: string | null) => {
    inMemoryToken = accessToken;
    if (accessToken) {
        axios.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    } else {
        delete axios.defaults.headers.common.Authorization;
    }
};

export const getUniqueArray = (arr1: string[], arr2: string[]): string[] => {
    // Combine both arrays into one using the spread operator
    const combinedArray = [...arr1, ...arr2];

    // Use Set to get unique values
    const uniqueArray = Array.from(new Set(combinedArray));

    return uniqueArray;
};
