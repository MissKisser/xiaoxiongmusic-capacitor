import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'com.xiaoxiong.music',
    appName: '小熊音乐',
    webDir: 'dist',
    server: {
        androidScheme: 'https',
    },
    android: {
        allowMixedContent: true,
        buildOptions: {
            keystorePath: undefined,
            keystorePassword: undefined,
            keystoreAlias: undefined,
            keystoreAliasPassword: undefined,
            releaseType: 'APK'
        }
    },
    plugins: {
        CapacitorHttp: {
            enabled: true,
        },
        CapacitorCookies: {
            enabled: true,
        },
        SplashScreen: {
            launchShowDuration: 2000,
            backgroundColor: '#ffffff',
            androidScaleType: 'CENTER_CROP',
            showSpinner: false,
            androidSpinnerStyle: 'large',
            spinnerColor: '#ff5a5f'
        },
        StatusBar: {
            style: 'DARK',
            backgroundColor: '#ffffff',
            overlaysWebView: false
        }
    }
};

export default config;
