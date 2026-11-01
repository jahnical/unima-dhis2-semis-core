import { DataStoreState, useDataStoreKey, useSchoolCalendarKey, SchoolCalendarData } from "dhis2-semis-components";
import { useLocation, useNavigate } from "react-router-dom";
import { useGetSectionTypeLabel, UserInfoState, useUrlParams } from "dhis2-semis-functions"
import { menuData } from "../../utils/constants/menu/menuData";
import { formatMenuData } from "../../utils/common/menu/formatMenuData";
import { useRecoilValue } from "recoil";
import { useEffect, useState } from "react";
import { dashboardData } from "../../utils/constants/dashboard/dashboardData";
import { ValidationSchema } from "../../schemas/validation/validationSchema";
import { UrlParamsState } from "../../schemas/urlParams/paramSchema";
import { useUserProgramAccess } from "../access/useUserProgramAccess";

const useMenuData = () => {
  const ulrParams = useRecoilValue(UrlParamsState)
  const { useQuery } = useUrlParams()
  const academicYear = useQuery.get("academicYear")
  const validation = useRecoilValue(ValidationSchema)
  const schoolCalendar = useSchoolCalendarKey()
  const location = useLocation();
  const navigate = useNavigate();
  const { sectionName } = useGetSectionTypeLabel()
  const { filters } = useDataStoreKey({ sectionType: sectionName ?? "" }) ?? [];
  const dataStoreData = useRecoilValue(DataStoreState)
  const [updatedMenuData, updateMenuData] = useState<any>([])
  const [homePageData, updatedHomePageData] = useState<any>([])
  const userInfoState = useRecoilValue(UserInfoState)
  const accessibleSections = useUserProgramAccess()


  let menuDataArray = menuData({
    pathname: location.pathname,
    filterDataElements: filters,
    navigate,
    locationParams: location?.search.slice(1),
    savedParams: ulrParams?.split("?")?.[1],
    academicYear: academicYear ?? schoolCalendar?.defaults?.academicYear
  })

  const updateData = (dadosBrutos: any[]) => {
    let copy = [...dadosBrutos];

    // Hide sections whose parent program the current user cannot access.
    // "navigation" and "configurations" are always kept — they are handled
    // separately by the super-user check further below.
    copy = copy.filter((item) => {
      if (item.id === "navigation" || item.id === "configurations") return true;
      return accessibleSections.has(item.id);
    });

    for (const element of dataStoreData) {
      const index = copy.findIndex(x => x.id === element.key);
      if (index === -1) continue;

      const originalSubItems = copy[index].subItems ?? [];
      const filteredSubItems = originalSubItems.filter((subItem: any) => {
        const key = subItem.id;
        return (element as any)[key]?.enabled === true;
      });

      copy[index].subItems = filteredSubItems;
    }

    for (const element of copy) {
      // if this position not exist in dataStoreData, hide all subitems minus configurations and navigation
      const index = dataStoreData.findIndex(x => x.key?.toLowerCase() === element.id);
      if (index === -1 && element.id !== "configurations" && element.id !== "navigation") {
        element.subItems = [];
      }
    }

    //hide admin title if no user doesnt have superuser authority
    const indexConfigurations = copy.findIndex(x => x.id === "configurations");

    // Determine if the user has superuser authority
    const isSuperUser = userInfoState?.authorities?.includes("ALL");

    if (!isSuperUser) {
      // Hide Admin title if the user does not have superuser authority
      copy[indexConfigurations].displayInMenu = false;
      copy[indexConfigurations].subItems = [];
    } else {
      // If no academic year defined, remove "SEMIS-Calendar"
      if (!schoolCalendar?.academicYear) {
        copy[indexConfigurations].subItems = copy[indexConfigurations].subItems.filter(
          (subItem: any) => subItem.id != "school-calendar"
        );
      }
    }

    return copy.filter(item => item.subItems?.length > 0);
  };

  useEffect(() => {
    if (dataStoreData?.length > 0 && validation.valid != false) {
      const sideBarData = updateData(menuDataArray)
      const initialPageData = updateData(structuredClone(dashboardData))
      updatedHomePageData(initialPageData)
      updateMenuData(formatMenuData({
        appsList: [], location,
        sectionType: sectionName,
        menuData: sideBarData
      }))
    } else {
      updatedHomePageData([dashboardData[dashboardData?.length - 1]])
      updateMenuData(menuDataArray?.filter(x => x.id != 'staff' && x.id != 'student'))
    }
  }, [dataStoreData, schoolCalendar, validation.valid, ulrParams])

  return {
    menuData: formatMenuData({
      appsList: [], location,
      sectionType: sectionName,
      menuData: updatedMenuData
    }),
    homePageData
  };
};

export { useMenuData };