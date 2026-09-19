// Salesforce object -> Postgres table mapping.
// Field API names are copied verbatim; the Postgres column is the lower-cased
// API name (Heroku Connect convention). Add a field here + in sql/001 to sync it.

export interface ObjectSpec {
  object: string;              // Salesforce API name
  table: string;               // Postgres table (schema salesforce)
  fields: string[];            // SOQL fields (Id first)
  /** Extra WHERE for the initial full load (e.g. limit Task history). */
  initialWhere?: string;
  /** Relationship fields to flatten: { "UserRole.Name": "userrole_name" } */
  flatten?: Record<string, string>;
  /** Use queryAll (includes deleted rows so IsDeleted is replicated). */
  queryAll?: boolean;
}

const LEAD_MASTER_FIELDS = [
  'Id', 'Name', 'CreatedDate', 'LastModifiedDate', 'SystemModstamp', 'IsDeleted', 'OwnerId',
  'First_Name__c', 'Last_Name__c', 'Mobile_Number__c', 'Email__c', 'Class__c', 'Lead_Source__c',
  'lead_source_detail__c', 'Lead_Stage__c', 'Lead_Type__c', 'Priority__c', 'District__c', 'City__c',
  'State__c', 'Campaign_Name__c', 'Campaign_Quality__c', 'Campaign_Tag__c', 'Campaign_Date__c',
  'Ad_Platform__c', 'Ad_Campaign__c', 'Ad_Set__c', 'Ad_Name__c', 'Ad_Class__c', 'Ad_Class_Match__c',
  'Enquiry_Assigned_Date__c', 'Follow_Up_Date__c', 'Next_Followup_Due__c', 'Touch_Count__c',
  'First_Touch_Date__c', 'First_Touch_Point__c', 'Last_Touch_Date__c', 'Last_Touch_Point__c',
  'Is_Converted__c', 'Converted_Date__c', 'Converted_After_First_Touch__c', 'Customer_Before_First_Touch__c',
  'Days_To_Convert__c', 'IC_Count__c', 'IC_Enrolled_Count__c', 'Best_IC_Status__c', 'IC_Course__c',
  'Enrollment_Count__c', 'Enrolled_Value__c', 'App_Engagement_Tier__c', 'App_Time_30d_Min__c',
  'App_Active_Days_30d__c', 'App_Last_Active__c', 'Is_Deleted__c', 'Is_Duplicate__c',
  'Parent_Lead_Master__c', 'LM_Reason__c', 'Hot_Lead__c', 'Supreme_Hot__c', 'Relogged_In__c',
  'gclid__c', 'fbclid__c', 'Meta_Lead_ID__c',
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
  'Course_Name__c', 'Status__c', 'Is_Enrolled__c', 'Fees_Offered__c', 'Assigned_Date__c',
  'Target_Customer__c', 'Ad_Campaign__c', 'Occupation_Categories__c', 'OwnerId',
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
  { object: 'Interested_Course__c', table: 'interested_course__c', fields: IC_FIELDS, queryAll: true,
    initialWhere: `CreatedDate >= ${process.env.LEAD_SINCE ?? '2025-04-01T00:00:00Z'}` },
  { object: 'Task', table: 'task', fields: TASK_FIELDS, queryAll: true,
    initialWhere: `CreatedDate >= ${process.env.TASK_SINCE ?? '2026-01-01T00:00:00Z'}` },
];
