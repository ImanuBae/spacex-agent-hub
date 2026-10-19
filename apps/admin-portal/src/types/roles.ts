export type Role =
  | "center_director"
  | "branch_director"
  | "admissions"
  | "accountant"
  | "teacher"
  | "student"
  | "ai_agent";

export interface MenuItem {
  title: string;
  href: string;
  icon?: string;
  roles: Role[];
}

export interface MenuGroup {
  groupTitle: string;
  items: MenuItem[];
}
