import { useRecoilValue } from "recoil";
import { UserInfoState } from "dhis2-semis-functions";
import { DataStoreState } from "dhis2-semis-components";

/**
 * Returns a Set of section keys (e.g. "student", "staff") that the current
 * user has access to, derived by cross-referencing userInfo.programs with
 * the program field on each DataStore entry.
 *
 * Super-users (authority "ALL") are granted access to all sections.
 * If userInfo has not yet loaded, returns an empty Set (safe default — hides
 * sections until confirmed accessible).
 */
export function useUserProgramAccess(): Set<string> {
    const userInfo = useRecoilValue(UserInfoState);
    const dataStoreData = useRecoilValue(DataStoreState) as any[];

    // If user info is not yet loaded, deny all (prevents flash of inaccessible items)
    if (!userInfo?.id) {
        return new Set<string>();
    }

    // Super-users can see all sections
    if (userInfo.authorities?.includes("ALL")) {
        return new Set<string>(dataStoreData.map((entry) => entry.key).filter(Boolean));
    }

    const userPrograms = new Set<string>(userInfo.programs ?? []);

    return new Set<string>(
        dataStoreData
            .filter((entry) => entry.program && userPrograms.has(entry.program))
            .map((entry) => entry.key)
    );
}
