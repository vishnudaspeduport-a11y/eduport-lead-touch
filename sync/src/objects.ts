// Salesforce object -> Postgres table mapping.
// Field API names are copied verbatim; the Postgres column is the lower-cased
// API name (Heroku Connect convention). Add a field here + in sql/001 to sync it.

export interface ObjectSpec {
  object: string;              // Salesforce API name
  /** watermark / restrict key when the same object is synced twice (default = object) */
  key?: string;
  table: string;               // Postgres table (schema salesforce)
  fields: string[];            // SOQL fields (Id first)
  /** Extra WHERE for the initial full load (e.g. limit Task history). */
  initialWhere?: string;
  /** Relationship fields to flatten: { "UserRole.Name": "userrole_name" } */
  flatten?: Record<string, string>;
  /** Use queryAll (includes deleted rows so IsDeleted is replicated). */
  queryAll?: boolean;
}

// Trimmed 2026-09-23 (storage): only the columns a page reads. Ad / campaign / app-engagement / hot-lead /
// follow-up / SF touch-summary fields were dropped from salesforce.lead_master__c (sql/015_slim.sql); add back here + a migration if needed.
const LEAD_MASTER_FIELDS = [
  'Id', 'Name', 'CreatedDate', 'SystemModstamp', 'IsDeleted', 'OwnerId',
  'First_Name__c', 'Last_Name__c', 'Mobile_Number__c', 'Email__c', 'Class__c', 'Lead_Source__c',
  'Lead_Stage__c', 'Lead_Type__c', 'Priority__c', 'District__c', 'City__c', 'Ad_Platform__c',
  'Touch_Count__c', 'Is_Converted__c', 'Best_IC_Status__c', 'Is_Deleted__c', 'Is_Duplicate__c',
  'Parent_Lead_Master__c', 'LM_Reason__c', 'gclid__c', 'fbclid__c', 'Meta_Lead_ID__c',
];

const LEAD_TOUCH_FIELDS = [
  'Id', 'Name', 'CreatedDate', 'SystemModstamp', 'IsDeleted', 'Lead_Master__c', 'Touch_Date__c',
  'Touch_Point__c', 'Source__c', 'Medium__c', 'Campaign__c', 'Adset_Name__c', 'Ad_Name__c',
  'Platform_ID__c', 'Staff__c', 'Is_First_Touch__c', 'Is_Last_Touch__c', 'Is_First_Of_Type__c',
  'Is_Converted__c', 'Converted_Date__c', 'Lead_Converted__c', 'Lead_Converted_Date__c',
  'Was_Customer_At_Touch__c', 'Attribution_Credit__c', 'Credit_Value__c', 'IC_Status__c',
  'IC_Course__c', 'IC_Name__c', 'Multiple_ICs__c',
];

const IC_FIELDS = [
  'Id', 'Name', 'CreatedDate', 'SystemModstamp', 'IsDeleted', 'Lead_Master__c', 'Course__c',
  'Course_Name__c', 'Status__c', 'Is_Enrolled__c',
];

const TASK_FIELDS = [
  'Id', 'WhatId', 'Mobile_Number__c', 'Subject', 'Type', 'Status', 'ActivityDate',
  'CallDurationInSeconds', 'Call_Status__c', 'Call_Start_Time__c', 'Reason__c',
  'Interested_Course_Status__c', 'OwnerId', 'IsDeleted', 'CreatedDate', 'SystemModstamp',
];

export const OBJECTS: ObjectSpec[] = [
  { object: 'User', table: 'user', fields: ['Id', 'Name', 'Email', 'IsActive', 'SystemModstamp', 'UserRole.Name', 'Profile.Name'],
    flatten: { 'UserRole.Name': 'userrole_name', 'Profile.Name': 'profile_name' } },
  { object: 'Course__c', table: 'course__c', fields: ['Id', 'Name', 'IsDeleted', 'SystemModstamp'], queryAll: true },
  { object: 'Lead_Master__c', table: 'lead_master__c', fields: LEAD_MASTER_FIELDS, queryAll: true,
    initialWhere: `CreatedDate >= ${process.env.LEAD_SINCE ?? '2025-04-01T00:00:00Z'}` },
  { object: 'Lead_Touch__c', table: 'lead_touch__c', fields: LEAD_TOUCH_FIELDS, queryAll: true },
  // Older leads (before the window) that HAVE touches: Tableau counts them, and they are few (~24k)
  { object: 'Lead_Master__c', key: 'Lead_Master__c_touched', table: 'lead_master__c', fields: LEAD_MASTER_FIELDS, queryAll: true,
    initialWhere: `CreatedDate < ${process.env.LEAD_SINCE ?? '2025-04-01T00:00:00Z'} AND Id IN (SELECT Lead_Master__c FROM Lead_Touch__c WHERE IsDeleted = false)` },
  // Older leads with NO touches but converted in Salesforce (flag or stage; old records only carry the stage) (~110k): paying app users are matched to them on phone,
  // so without them the Converted page shows those payers as "No Salesforce lead"
  { object: 'Lead_Master__c', key: 'Lead_Master__c_converted', table: 'lead_master__c', fields: LEAD_MASTER_FIELDS, queryAll: true,
    initialWhere: `CreatedDate < ${process.env.LEAD_SINCE ?? '2025-04-01T00:00:00Z'} AND (Is_Converted__c = true OR Lead_Stage__c = 'Converted') AND Id NOT IN (SELECT Lead_Master__c FROM Lead_Touch__c WHERE IsDeleted = false)` },
  { object: 'Interested_Course__c', table: 'interested_course__c', fields: IC_FIELDS, queryAll: true,
    initialWhere: `CreatedDate >= ${process.env.LEAD_SINCE ?? '2025-04-01T00:00:00Z'}` },
  { object: 'Interested_Course__c', key: 'Interested_Course__c_touched', table: 'interested_course__c', fields: IC_FIELDS, queryAll: true,
    initialWhere: `CreatedDate < ${process.env.LEAD_SINCE ?? '2025-04-01T00:00:00Z'} AND Lead_Master__c IN (SELECT Lead_Master__c FROM Lead_Touch__c WHERE IsDeleted = false)` },
  { object: 'Task', table: 'task', fields: TASK_FIELDS, queryAll: true,
    initialWhere: `CreatedDate >= ${process.env.TASK_SINCE ?? '2026-01-01T00:00:00Z'}` },
];
