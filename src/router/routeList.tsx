import Home from "../pages/home";
import { AdmissionPage } from "dhis2-semis-admission";
import { EnrollmentPage } from "dhis2-semis-enrollment";
import { Transfer } from "dhis2-semis-transfer"
import { TransferExecute } from "dhis2-semis-transfer-execute"
import { Performance } from "dhis2-semis-performance"
import { ConfigirationsPage } from "dhis2-semis-configurations";
import i18n from "../locales/index.js";
import { App as AttendancePage } from "dhis2-semis-attendance";
import { FinalResult, StaffReEnrollment } from "dhis2-semis-final-result";
import { SchoolCalendar } from "dhis2-semis-school-calendar";
import { useConfig } from "@dhis2/app-runtime";
import { ProtectedRoute } from "./ProtectedRoute";

export default function RouteList() {
    const { baseUrl } = useConfig()
    return [
        {
            path: "/semis",
            component: <Home />
        },
        {
            path: "/semis/admissions",
            component: (
                <ProtectedRoute sectionKey="student">
                    <AdmissionPage i18n={i18n} baseUrl={baseUrl} />
                </ProtectedRoute>
            )
        },
        {
            path: "/semis/enrollments",
            // Shared by student and staff — not wrapped; section context is
            // passed via ?sectionType query param
            component: <EnrollmentPage i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/attendance",
            // Shared by student and staff — not wrapped
            component: <AttendancePage i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/performance",
            component: (
                <ProtectedRoute sectionKey="student">
                    <Performance i18n={i18n} baseUrl={baseUrl} />
                </ProtectedRoute>
            )
        },
        {
            path: "/semis/transfer",
            // Shared by student and staff — not wrapped
            component: <Transfer i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/transfer-execute",
            // Shared by student and staff — not wrapped
            component: <TransferExecute i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/final-result",
            component: (
                <ProtectedRoute sectionKey="student">
                    <FinalResult i18n={i18n} baseUrl={baseUrl} />
                </ProtectedRoute>
            )
        },
        {
            path: "/semis/re-enroll",
            component: (
                <ProtectedRoute sectionKey="staff">
                    <StaffReEnrollment i18n={i18n} baseUrl={baseUrl} />
                </ProtectedRoute>
            )
        },
        {
            path: "/semis/configuration",
            component: <ConfigirationsPage i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/school-calendar/*",
            component: <SchoolCalendar i18n={i18n} baseUrl={baseUrl} />
        }
    ];
}
