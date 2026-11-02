import { Navigate } from "react-router-dom";
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
 */
export function ProtectedRoute({ sectionKey, children }: Props) {
    const accessibleSections = useUserProgramAccess();

    if (!accessibleSections.has(sectionKey)) {
        return <Navigate to="/semis" replace />;
    }

    return <>{children}</>;
}
