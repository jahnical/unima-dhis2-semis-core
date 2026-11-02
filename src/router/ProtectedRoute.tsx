import { Navigate } from "react-router-dom";
import { useRecoilValue } from "recoil";
import { Center, CircularLoader } from "@dhis2/ui";
import { UserInfoState } from "dhis2-semis-functions";
import { DataStoreState } from "dhis2-semis-components";
import { useUserProgramAccess } from "../hooks/access/useUserProgramAccess";

type Props = {
    /** The datastore section key whose program access is required. */
    sectionKey: "student" | "staff";
    children: React.ReactNode;
};

/**
 * Redirects to the Home page if the current user does not have access
 * to the DHIS2 program associated with the given sectionKey.
 *
 * This guards against direct URL navigation to restricted submodules,
 * complementing the sidebar/home page visibility filtering in useMenuData.
 *
 * Access is only decided once the user and the datastore configuration have loaded: deciding earlier
 * would send every refreshed, bookmarked or shared page to Home and lose its filters.
 */
export function ProtectedRoute({ sectionKey, children }: Props) {
    const userInfo = useRecoilValue(UserInfoState);
    const dataStoreData = useRecoilValue(DataStoreState) as any[];
    const accessibleSections = useUserProgramAccess();

    if (!userInfo?.id || !dataStoreData?.length) {
        return (
            <Center>
                <CircularLoader />
            </Center>
        );
    }

    if (!accessibleSections.has(sectionKey)) {
        return <Navigate to="/semis" replace />;
    }

    return <>{children}</>;
}
