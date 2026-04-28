import Home from "../pages/home";
// import { AdmissionPage } from "dhis2-semis-admission";
import { EnrollmentPage } from "dhis2-semis-enrollment";
import { Transfer } from "dhis2-semis-transfer"
import { TransferExecute } from "dhis2-semis-transfer-execute"
import { Performance } from "dhis2-semis-performance"
import { ConfigirationsPage } from "dhis2-semis-configurations";
import i18n from "../locales/index.js";
import { App as AttendancePage } from "dhis2-semis-attendance";
import { FinalResult } from "dhis2-semis-final-result";
import { SchoolCalendar } from "dhis2-semis-school-calendar";
import { useConfig } from "@dhis2/app-runtime";

export default function RouteList() {
    const { baseUrl } = useConfig()
    return [
        {
            path: "/semis",
            component: <Home />
        },
        // {
        //     path: "/semis/admissions",
        //     component: <AdmissionPage i18n={i18n} baseUrl={baseUrl} />
        // },
        {
            path: "/semis/enrollments",
            component: <EnrollmentPage i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/attendance",
            component: <AttendancePage i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/performance",
            component: <Performance i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/transfer",
            component: <Transfer i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/transfer-execute",
            component: <TransferExecute i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/final-result",
            component: <FinalResult i18n={i18n} baseUrl={baseUrl} />
        },
        {
            path: "/semis/re-enroll",
            component: <FinalResult i18n={i18n} baseUrl={baseUrl} />
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
