'use strict';
// Shared product constants (kept out of db.js so migrations and the app agree on them).
const ACCESS_DEFAULT = '{"main_platform":true,"crm":true,"admin_dashboard":false,"api":false}';
const ROLE_PRESETS = {
  super_admin: ['manage_content', 'view_reports', 'manage_users', 'access_crm', 'manage_listings'],
  admin: ['manage_content', 'view_reports', 'manage_users', 'access_crm', 'manage_listings'],
  content_manager: ['manage_content', 'view_reports', 'manage_listings'],
  community_manager: ['manage_content', 'manage_users'],
  marketing_lead: ['manage_content', 'view_reports'],
  developer: ['view_reports'],
  team_member: ['manage_content', 'view_reports', 'manage_users'],
};
const PERMISSIONS = ['manage_content', 'view_reports', 'manage_users', 'access_crm', 'manage_listings'];
module.exports = { ACCESS_DEFAULT, ROLE_PRESETS, PERMISSIONS };
