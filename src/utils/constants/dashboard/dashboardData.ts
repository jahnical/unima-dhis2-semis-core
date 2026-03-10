import resultImage from "../../../assets/images/home/result.png";
import transferImage from "../../../assets/images/home/transfer.png";
import enrollmentImage from "../../../assets/images/home/enrollment.png";
import attendanceImage from "../../../assets/images/home/attendance.png";
import performanceImage from "../../../assets/images/home/performance.png";
import schoolCallendar from "../../../assets/images/home/callendar.svg";
import settings from "../../../assets/images/home/settings.svg";
import i18n from "../../../locales"

const studentCards = [
    { label: i18n.t("Admission"), id: "admission", icon: enrollmentImage, path: "admissions" },
    { label: i18n.t("Enrollment"), id: "registration", icon: enrollmentImage, path: "enrollments" },
    { label: i18n.t("Attendance"), id: "attendance", icon: attendanceImage, path: "attendance" },
    { label: i18n.t("Performance"), id: "performance", icon: performanceImage, path: "performance" },
    { label: i18n.t("Transfer"), id: "transfer", icon: transferImage, path: "transfer" },
    { label: i18n.t("Final Result"), id: "final-result", icon: resultImage, path: "final-result" },
];

const staffCards = [
    { label: i18n.t("Staff registry"), id: "registration", icon: enrollmentImage, path: "enrollments" },
    { label: i18n.t("Attendance"), id: "attendance", icon: attendanceImage, path: "attendance" },
    { label: i18n.t("Transfer"), id: "transfer", icon: transferImage, path: "transfer" },
    { label: i18n.t("Re-enroll"), id: "final-result", icon: resultImage, path: "re-enroll" },
];

const configurations = [
    { label: i18n.t("Configurations"), icon: settings, path: "configuration" },
    { label: i18n.t("School Calendar"), icon: schoolCallendar, path: "school-calendar", id: "school-calendar" }
];

const dashboardData = [
    { key: 0, id: "student", title: i18n.t("Student"), subItems: studentCards },
    { key: 1, id: "staff", title: i18n.t("Staff"), subItems: staffCards },
    { key: 2, id: "configurations", title: i18n.t("Configurations"), subItems: configurations }
]

export { staffCards, studentCards, dashboardData }