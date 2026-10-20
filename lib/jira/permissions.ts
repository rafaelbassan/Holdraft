export const JIRA_PERMISSIONS = {
  BROWSE_PROJECTS: "BROWSE_PROJECTS",
  CREATE_ISSUES: "CREATE_ISSUES",
  ASSIGN_ISSUES: "ASSIGN_ISSUES",
  MANAGE_WATCHERS: "MANAGE_WATCHERS",
  ADMINISTER_PROJECTS: "ADMINISTER_PROJECTS",
  ADMINISTER: "ADMINISTER",
} as const;

export type JiraPermissionKey =
  (typeof JIRA_PERMISSIONS)[keyof typeof JIRA_PERMISSIONS];

export const ALL_TRACKED_PERMISSIONS: JiraPermissionKey[] = [
  JIRA_PERMISSIONS.BROWSE_PROJECTS,
  JIRA_PERMISSIONS.CREATE_ISSUES,
  JIRA_PERMISSIONS.ASSIGN_ISSUES,
  JIRA_PERMISSIONS.MANAGE_WATCHERS,
  JIRA_PERMISSIONS.ADMINISTER_PROJECTS,
  JIRA_PERMISSIONS.ADMINISTER,
];

export type PermissionEntry = {
  id: string;
  key: string;
  name?: string;
  havePermission: boolean;
};

export type ParsedPermissions = Record<JiraPermissionKey, boolean>;

export function parseMyPermissionsResponse(data: {
  permissions?: Record<
    string,
    { id?: string; key?: string; name?: string; havePermission?: boolean }
  >;
}): ParsedPermissions {
  const result = {} as ParsedPermissions;
  for (const key of ALL_TRACKED_PERMISSIONS) {
    const entry = data.permissions?.[key];
    result[key] = entry?.havePermission === true;
  }
  return result;
}

export function canBrowseProjects(perms: ParsedPermissions): boolean {
  return perms.BROWSE_PROJECTS;
}

export function canCreateIssues(perms: ParsedPermissions): boolean {
  return perms.CREATE_ISSUES;
}

export function canAssignIssues(perms: ParsedPermissions): boolean {
  return perms.ASSIGN_ISSUES;
}

export function canManageWatchers(perms: ParsedPermissions): boolean {
  return perms.MANAGE_WATCHERS;
}

export function canAdministerProjects(perms: ParsedPermissions): boolean {
  return perms.ADMINISTER_PROJECTS;
}

export function canAdminister(perms: ParsedPermissions): boolean {
  return perms.ADMINISTER;
}
