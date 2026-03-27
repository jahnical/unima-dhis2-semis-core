import { useDataStoreStatus, WithPadding, DataStoreState } from "dhis2-semis-components";
import { NoticeBox } from "@dhis2/ui";
import { useRecoilState, useRecoilValue } from "recoil";
import { useEffect, useState } from "react";
import AlertWithActions from "../alert/alertWithActions";
import { useValidate } from "../../utils/constants/valuesFormatter/valuesFormatter";
import { ValidationSchema } from "../../schemas/validation/validationSchema";
import { values } from "../../utils/constants/values/values";
import i18n from "../../locales";

const Validator = () => {
    const dataStore: any = useRecoilValue(DataStoreState)
    const [open, setOpen] = useState<boolean>(false)
    const { validateAndConvertArrayAgainstReference } = useValidate()
    const { dataStoreStatus } = useDataStoreStatus()
    const [validation, setValidation] = useRecoilState<any>(ValidationSchema)


    useEffect(() => {
        console.log("SEMIS_DEBUG[Validator] effect", {
            notFoundConfig: dataStoreStatus?.not_found_config,
            notFoundCalendar: dataStoreStatus?.not_found_calendar,
            dataStoreLength: Array.isArray(dataStore) ? dataStore.length : null,
            dataStoreType: typeof dataStore
        })

        if (dataStoreStatus?.not_found_config) {
            console.log("SEMIS_DEBUG[Validator] skip conversion prompt: config not found")
            setOpen(false)
            return
        }

        if (Array.isArray(dataStore) && dataStore.length === 0) {
            console.log("SEMIS_DEBUG[Validator] skip conversion prompt: datastore is empty array")
            setOpen(false)
            return
        }

        if (dataStore != undefined) {
            const { errors, isValid, converted, academicYear, currentAcademicYear } = validateAndConvertArrayAgainstReference(
                dataStore,
                values as unknown as any
            )

            console.log("SEMIS_DEBUG[Validator] validation result", {
                isValid,
                errorCount: errors?.length,
                firstErrors: (errors || []).slice(0, 5),
                convertedLength: converted?.length,
                academicYear,
                currentAcademicYear
            })

            if (!isValid) {
                console.log("SEMIS_DEBUG[Validator] opening conversion modal")
                setValidation({ valid: true, converted: converted, deniedConversion: false, year: academicYear, currentAcademicYear: currentAcademicYear })
                setOpen(true)
            } else {
                console.log("SEMIS_DEBUG[Validator] data is valid, closing conversion modal")
                setOpen(false)
                setValidation((prev: any) => ({ ...prev, valid: true }))
            }
        }
    }, [dataStore, dataStoreStatus?.not_found_config])

    return (
        <WithPadding p={Boolean(dataStoreStatus?.not_found_config || dataStoreStatus?.not_found_calendar || validation.deniedConversion) ? "10px 30px" : "0px"}>
            {
                dataStoreStatus?.not_found_config &&
                <div style={{ marginBottom: "8px" }}>
                    <NoticeBox warning title={i18n.t('No configuration found!')}>
                        {i18n.t('Use semis configuration app to setup your semis workspace.')}
                    </NoticeBox>
                </div>
            }
            {
                !dataStoreStatus?.not_found_config && dataStoreStatus?.not_found_calendar &&
                <NoticeBox warning title={`School calendar configuration not found!`}>
                    {i18n.t('Go to Configurations -> Enrollment application and set value to academic year field.')}
                </NoticeBox>
            }

            {open && <AlertWithActions setValidation={setValidation} validation={validation} open={open} setOpen={setOpen} />}

            {
                validation.deniedConversion == true &&
                <div>
                    <NoticeBox warning title={i18n.t('Invalid configurations!')}>
                        {i18n.t('The configurations found are not compatible with this version of SEMIS, please go to configurations app below and update the configrations!')}
                    </NoticeBox>
                </div>
            }
        </WithPadding>
    )
}

export default Validator