import { useState } from "react";

type AnyObject = Record<string, any>;

interface ValidationResult {
    isValid: boolean;
    errors: string[];
    converted: AnyObject[];
    academicYear: any;
    currentAcademicYear: any;
}

export function validateNestedKeys(
    inputObj: any,
    refObj: any,
    parentKey: string,
    errors: string[]
): void {
    if (!inputObj || !refObj) return;

    for (const key of Object.keys(inputObj)) {
        const inputVal = inputObj[key];
        const refVal = refObj[key];

        if (!(key in refObj)) {
            // Ignore unknown legacy keys during compatibility validation.
            continue;
        }

        if (Array.isArray(inputVal) && Array.isArray(refVal)) {
            inputVal.forEach((item, i) => {
                if (typeof item === "object" && item !== null) {
                    validateNestedKeys(item, refVal[0], `${parentKey}.${key}[${i}]`, errors);
                }
            });
            continue;
        }

        if (
            typeof inputVal === "object" &&
            inputVal !== null &&
            typeof refVal === "object" &&
            refVal !== null &&
            !Array.isArray(inputVal)
        ) {
            validateNestedKeys(inputVal, refVal, `${parentKey}.${key}`, errors);
        }
    }
}


export function mergeDeep(ref: any, input: any, errors: any[]): any {

    if (typeof ref !== 'object' || ref === null || ref?.length == 0)
        return input !== undefined ? input : ref;

    if (Array.isArray(ref)) {
        if (Array.isArray(input)) return input.map((item) => mergeDeep(ref[0], item, errors));

        return ref;
    }

    const merged: any = {};
    const referenceKeys = Object.keys(ref || {});

    for (const key of referenceKeys) {
        if (!Object.keys(input || {})?.some(x => x == key)) errors.push(
            `Missing required field '${key}' in object: ${JSON.stringify(input)}`
        )

        merged[key] = mergeDeep(ref[key], input?.[key], errors);
    }

    return merged;
}

export const useValidate = () => {
    let academicYear: string = '';
    let currentAcademicYear: string = '';

    function validateAndConvertArrayAgainstReference(
        input: AnyObject[],
        reference: AnyObject[]
    ): ValidationResult {
        const errors: string[] = [];
        const converted: AnyObject[] = [];
        const inputCopy = [...(input?.length > 0 ? input : [])]

        console.log("SEMIS_DEBUG[valuesFormatter] validate start", {
            inputLength: Array.isArray(input) ? input.length : null,
            inputKeys: Array.isArray(input) ? input.map((item) => item?.key) : null,
            referenceLength: Array.isArray(reference) ? reference.length : null,
            referenceKeys: Array.isArray(reference) ? reference.map((item) => item?.key) : null
        })

        if (inputCopy.length === 0) {
            console.log("SEMIS_DEBUG[valuesFormatter] empty input treated as valid")
            return {
                isValid: true,
                errors,
                converted: reference,
                academicYear,
                currentAcademicYear,
            };
        }

        for (const item of inputCopy) {

            const requiredKeys = ['key', 'program', 'registration', 'defaults'];
            for (const reqKey of requiredKeys) {
                if (!(reqKey in item)) {
                    errors.push(
                        `Missing required field '${reqKey}' in object: ${JSON.stringify(item)}`
                    );
                }
            }
            currentAcademicYear = item?.defaults?.currentAcademicYear || '';
            academicYear = item?.registration?.academicYear || '';

            const refItem = reference.find(r => r.key === item.key);
            if (!refItem) {
                console.log("SEMIS_DEBUG[valuesFormatter] skipping unknown top-level key", { key: item?.key })
                continue;
            }

            const output: AnyObject = {
                defaults: (item.defaults ?? reference.find(r => r.key === item.key)?.defaults) || {},
                key: item.key,
                program: item.program,
                registration: {
                    ...Object.fromEntries(
                        Object.entries(item.registration).filter(([k]) => k in refItem.registration)
                    )
                }
            };

            if (item.registration && refItem.registration) {
                validateNestedKeys(item.registration, refItem.registration, 'registration', errors);
            }

            if (item.attendance && !item.absenteeism && refItem.absenteeism) {
                output.absenteeism = { ...refItem.absenteeism };
            }

            for (const key of Object.keys(item)) {
                if (key in refItem) {
                    const refValue = refItem[key];
                    const inputValue = item[key];

                    if (typeof refValue === 'object' && refValue !== null) {
                        output[key] = mergeDeep(refValue, inputValue, errors);

                        if (key !== 'registration') {
                            validateNestedKeys(inputValue, refValue, key, errors);
                        }
                    } else {
                        output[key] = inputValue;
                    }
                } else {
                    // Ignore unknown legacy keys at top-level.
                }

            }

            for (const key of Object.keys(refItem)) {
                if (!(key in item)) output[key] = refItem[key];
            }

            converted.push(output);
        }

        console.log("SEMIS_DEBUG[valuesFormatter] validate done", {
            isValid: errors?.length === 0,
            errorCount: errors.length,
            firstErrors: errors.slice(0, 10),
            convertedLength: converted.length,
            academicYear,
            currentAcademicYear
        })

        return {
            isValid: errors?.length === 0,
            errors,
            converted: converted?.length > 0 ? converted : reference,
            academicYear,
            currentAcademicYear,
        };
    }

    return { validateAndConvertArrayAgainstReference }
};