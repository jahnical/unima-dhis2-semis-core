import { NavigateFunction } from "react-router-dom";
import home from "../../../assets/images/sidebar/home.svg";
import gauge from "../../../assets/images/sidebar/gauge.svg";
import glyph from "../../../assets/images/sidebar/Glyph.svg";
import logOut from "../../../assets/images/sidebar/log-out.svg";
import listAdd from "../../../assets/images/sidebar/listAdd.svg";
import editNote from "../../../assets/images/sidebar/edit_note_24dp.svg";
import userGroup from "../../../assets/images/sidebar/user-group.svg";
import settings from "../../../assets/images/sidebar/settings.svg";
import fileDocument from "../../../assets/images/sidebar/file-document.svg";
import callendar from "../../../assets/images/sidebar/callendar.svg";
import i18n from "../../../locales/index.js";

import { DataStoreProps } from "dhis2-semis-types";
import { subItemRoute } from "../../common/menu/subItemRoute";

type menuDataParams = {
  academicYear: string;
  savedParams: string | null | undefined;
  pathname: string;
  navigate: NavigateFunction;
  locationParams: string;
  filterDataElements: DataStoreProps[0]["filters"];
};

export const menuData = ({
  pathname,
  navigate,
  locationParams,
  filterDataElements,
  academicYear,
}: menuDataParams): any[] => {

  return [
    {
      title: i18n.t("Navigation"),
      id: "navigation",
      displayInMenu: true,
      subItems: [
        {
          icon: home,
          displayInMenu: true,
          label: i18n.t("Home"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS",
          id: "home",
          route: `/semis`,
          appUrl: "#/semis",
          active: true,
          action: () => navigate("/semis"),
        },
      ],
    },
    {
      title: i18n.t("Student"),
      id: "student",
      displayInMenu: true,
      subItems: [
        {
          icon: listAdd,
          displayInMenu: true,
          label: i18n.t("Admission"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Admission",
          id: "admission",
          route: "/semis/admissions",
          appUrl: `#/semis/admissions`,
          active: false,
          action: () =>
            navigate(
              `/semis/admissions?${subItemRoute(
                locationParams,
                "student",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: editNote,
          displayInMenu: true,
          label: i18n.t("Enrollment"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Enrollment",
          id: "registration",
          route: "/semis/enrollments",
          appUrl: `#/semis/enrollments`,
          active: false,
          action: () =>
            navigate(
              `/semis/enrollments?${subItemRoute(
                locationParams,
                "student",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: glyph,
          displayInMenu: true,
          label: i18n.t("Attendance"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Attendance",
          id: "attendance",
          route: "/semis/attendance",
          appUrl: `#/semis/attendance`,
          active: true,
          action: () =>
            navigate(
              `/semis/attendance?${subItemRoute(
                locationParams,
                "student",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: fileDocument,
          displayInMenu: true,
          label: i18n.t("Performance"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Performance",
          id: "performance",
          route: "/semis/performance",
          appUrl: `#/semis/performance`,
          active: false,
          action: () =>
            navigate(
              `/semis/performance?${subItemRoute(
                locationParams,
                "student",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: gauge,
          displayInMenu: true,
          label: i18n.t("Final result"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Final-Result",
          id: "final-result",
          route: "/semis/final-result",
          appUrl: `#/semis/final-result`,
          active: false,
          action: () =>
            navigate(
              `/semis/final-result?${subItemRoute(
                locationParams,
                "student",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: logOut,
          displayInMenu: true,
          label: i18n.t("Transfer"),
          badgeInfo: "",
          disabled: false,
          activationRoutes: ["/semis/transfer", "/semis/transfer-execute"],
          appName: "SEMIS-Transfer",
          id: "transfer",
          route: "/semis/transfer",
          appUrl: `#/semis/transfer`,
          active: false,
          action: () =>
            navigate(
              `/semis/transfer?${subItemRoute(
                locationParams,
                "student",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
      ],
    },
    {
      title: i18n.t("Staff"),
      id: "staff",
      displayInMenu: true,
      subItems: [
        {
          icon: userGroup,
          displayInMenu: true,
          label: i18n.t("Staff registry"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Enrollment",
          id: "registration",
          route: "/semis/enrollments",
          appUrl: `#/semis/enrollments`,
          active: false,
          action: () =>
            navigate(
              `/semis/enrollments?${subItemRoute(
                locationParams,
                "staff",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: glyph,
          displayInMenu: true,
          label: i18n.t("Attendance"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Attendance",
          id: "attendance",
          route: "/semis/attendance",
          appUrl: `#/semis/attendance`,
          active: false,
          action: () =>
            navigate(
              `/semis/attendance?${subItemRoute(
                locationParams,
                "staff",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: logOut,
          displayInMenu: true,
          label: i18n.t("Transfer"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Transfer",
          id: "transfer",
          activationRoutes: ["/semis/transfer", "/semis/transfer-execute"],
          route: "/semis/transfer",
          appUrl: `#/semis/transfer`,
          active: false,
          action: () =>
            navigate(
              `/semis/transfer?${subItemRoute(
                locationParams,
                "staff",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
        {
          icon: gauge,
          displayInMenu: true,
          label: i18n.t("Staff Re-enroll"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-re-enroll",
          id: "final-result",
          route: "/semis/re-enroll",
          appUrl: `#/semis/re-enroll`,
          active: false,
          action: () =>
            navigate(
              `/semis/re-enroll?${subItemRoute(
                locationParams,
                "staff",
                academicYear,
                filterDataElements,
                pathname
              )}`
            ),
        },
      ],
    },
    {
      title: i18n.t("Configurations"),
      id: "configurations",
      displayInMenu: true,
      subItems: [
        {
          icon: callendar,
          id: "school-calendar",
          displayInMenu: true,
          label: i18n.t("School Calendar"),
          badgeInfo: "",
          disabled: false,
          appName: "SEMIS-Calendar",
          route: `/semis/school-calendar`,
          appUrl: "#/semis/school-calendar",
          active: false,
          action: () => navigate("/semis/school-calendar"),
        },
        {
          icon: settings,
          displayInMenu: true,
          label: i18n.t("Configurations"),
          badgeInfo: "",
          disabled: false,
          appName: "Semis-configurations",
          id: "",
          route: "/semis/configuration",
          appUrl: `#/semis/configuration`,
          active: false,
          action: () => navigate(`/semis/configuration`),
        },
      ],
    },
  ];
};
