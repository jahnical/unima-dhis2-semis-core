// Used by `d2-app-scripts test`, which merges it over its defaults. The library aliases below mirror
// the Vite aliases in viteConfigExtensions.mts so tests resolve modules the same way the app does.
const defaults = require('@dhis2/cli-app-scripts/config/jest.config.js')

module.exports = {
    roots: ['./src', './scripts'],
    testPathIgnorePatterns: ['/node_modules/', '/build/', '/.d2/'],
    moduleNameMapper: {
        ...defaults.moduleNameMapper,
        '^dhis2-semis-functions$': '<rootDir>/src/libs/functions/src',
        '^dhis2-semis-components$': '<rootDir>/src/libs/components/src',
        '^dhis2-semis-types$': '<rootDir>/src/libs/types/src',
    },
}
