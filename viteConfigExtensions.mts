import path from 'path'
import { defineConfig } from 'vite'

const viteConfig = defineConfig(async (configEnv) => {
    const { mode } = configEnv
    return {
        clearScreen: mode !== 'development',

        resolve: {
            alias: {
                // '@': path.resolve(__dirname, 'src'),
                // '@modules': path.resolve(__dirname, 'src/modules'),
                // '@libs': path.resolve(__dirname, 'src/libs'),
                'dhis2-semis-components': path.resolve(__dirname, './src/libs/components/src'),
                'dhis2-semis-functions': path.resolve(__dirname, './src/libs/functions/src'),
                'dhis2-semis-types': path.resolve(__dirname, './src/libs/types/src'),

                'dhis2-semis-admission': path.resolve(__dirname, './src/modules/admission/src'),
                'dhis2-semis-enrollment': path.resolve(__dirname, './src/modules/enrollment/src'),
                'dhis2-semis-attendance': path.resolve(__dirname, './src/modules/attendance/src'),
                'dhis2-semis-final-result': path.resolve(__dirname, './src/modules/final-result/src'),
                'dhis2-semis-performance': path.resolve(__dirname, './src/modules/performance/src'),
                'dhis2-semis-configurations': path.resolve(__dirname, './src/modules/configurations/src'),
                'dhis2-semis-school-calendar': path.resolve(__dirname, './src/modules/school-calendar/src'),
                'dhis2-semis-transfer': path.resolve(__dirname, './src/modules/transfer/src'),
                'dhis2-semis-transfer-execute': path.resolve(__dirname, './src/modules/transfer-execute/src'),
            }
        },

    }
})

export default viteConfig
