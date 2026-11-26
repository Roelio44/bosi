import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import svgr from 'vite-plugin-svgr';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd());

    return {
        build: {
            outDir: env.VITE_BUILD_OUT_DIR || 'dist',
        },
        plugins: [react(), tsconfigPaths(), svgr()],
        resolve: {
            dedupe: [
                'react',
                'react-dom',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                '@emotion/react',
                '@emotion/styled',
                '@mui/material',
                '@mui/icons-material'
            ],
            alias: {
                '@': path.resolve(__dirname, './src'),
            },
        },
        optimizeDeps: {
            entries: ['index.html', 'src/**/*.{ts,tsx}'],
            include: [
                'react',
                'react-dom',
                'react-dom/client',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                '@emotion/react',
                '@emotion/styled',
                '@mui/material',
                '@mui/icons-material'
            ]
        },
        server: {
            host: '0.0.0.0',
            port: 3000,
            allowedHosts: true,
            hmr: process.env.DISABLE_HMR !== 'true',
            watch: process.env.DISABLE_HMR === 'true' ? null : {},
        }
    };
});