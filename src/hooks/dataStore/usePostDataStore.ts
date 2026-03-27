import { useShowAlerts } from "dhis2-semis-functions"
import { useDataEngine } from "@dhis2/app-runtime"
import { useState } from "react"

// const QUERY: any = {
//     resource: `dataStore/semis/values`,
//     type: "update",
//     data: ({ data }: any) => data,
//     params: {
//         importStrategy: 'CREATE_AND_UPDATE'
//     }
// }
const type: any = 'update'

export default function usePostDataStore({ keySpace }: { keySpace: any }) {
    const engine = useDataEngine()
    const [error, setError] = useState<boolean>()
    const [loading, setLoading] = useState<boolean>(false)
    const { show, hide } = useShowAlerts()

    const createDataStore = async ({ data }: { data: any }) => {
        setLoading(true)
        console.log("SEMIS_DEBUG[usePostDataStore] mutate start", {
            keySpace,
            payloadType: Array.isArray(data) ? "array" : typeof data,
            payloadLength: Array.isArray(data) ? data.length : undefined,
            payloadKeys: !Array.isArray(data) && data ? Object.keys(data) : undefined
        })

        await engine.mutate(
            {
                resource: keySpace,
                type: type,
                data: data,
                params: {
                    importStrategy: 'CREATE_AND_UPDATE'
                }
            }, {
            onComplete: async () => {
                setLoading(false)
                console.log("SEMIS_DEBUG[usePostDataStore] mutate success", { keySpace })
                show({ message: "Configuration updated successfully!", type: { success: true } })
            },
            onError: (mutationError: unknown) => {
                setError(true)
                setLoading(false)
                console.log("SEMIS_DEBUG[usePostDataStore] mutate error", { keySpace, mutationError })
                show({
                    message: `Could not update configuration`,
                    type: { critical: true }
                });
                setTimeout(hide, 5000);
            }
        })


    }
    return { createDataStore, loading, error }
}