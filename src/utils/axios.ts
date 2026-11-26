import axios from 'axios';
// config
import { HOST_API_KEY } from 'config';

// ----------------------------------------------------------------------

const axiosInstance = axios.create({ baseURL: HOST_API_KEY || '' });

axiosInstance.interceptors.response.use(
    (response) => {
        const contentType = response.headers?.['content-type'];
        if (typeof response.data === 'string' && contentType?.includes('text/html')) {
            return Promise.reject('Unexpected HTML response from API');
        }
        return response;
    },
    (error) => Promise.reject((error?.response && error.response.data) || error || 'Something went wrong')
);

export default axiosInstance;

export const ASSETS = (name: string) => {
    if (!name) return '';
    if (name.startsWith('http://') || name.startsWith('https://') || name.startsWith('/')) {
        return name;
    }
    return HOST_API_KEY ? `${HOST_API_KEY}/${name}` : `/${name}`;
};
