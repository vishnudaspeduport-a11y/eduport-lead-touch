import { BreakdownCard } from '../components/BreakdownCard';
import { Note, PageHeader } from '../components/ui';

export default function Segments() {
  return (
    <div className="space-y-3">
      <PageHeader title="Segments" subtitle="Who converts: class, geography, priority, lead type, app engagement, hot flags, repeat leads. Every bar is clickable." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <BreakdownCard dim="class_group" title="Class group" help="Class__c normalised by analytics.class_group() into Class 4-12, Plus Two Completed, Repeater, Other, Unknown. Fix the mapping in sql/002_functions.sql - one place." />
        <BreakdownCard dim="app_tier" title="App engagement tier: does app usage predict conversion?" defaultMetric="conv_rate" help="App_Engagement_Tier__c (Hot / Warm / Cold / Inactive / null). Compare conversion % across tiers; '(null)' = no app activity synced." />
        <BreakdownCard dim="district" title="District (top 15 + rest in table)" limit={15} />
        <BreakdownCard dim="city" title="City (top 15)" limit={15} />
        <BreakdownCard dim="priority" title="Priority" defaultMetric="conv_rate" />
        <BreakdownCard dim="lead_type" title="Lead type" limit={15} />
        <BreakdownCard dim="hot" title="Hot lead flag" defaultMetric="conv_rate" help="Hot_Lead__c is a date on the lead; 'Hot' = date set." />
        <BreakdownCard dim="supreme_hot" title="Supreme Hot flag" defaultMetric="conv_rate" />
        <BreakdownCard dim="relogged" title="Re-logged leads (Relogged_In__c)" defaultMetric="conv_rate" />
        <BreakdownCard dim="repeat" title="Repeat leads (Parent_Lead_Master__c set)" defaultMetric="conv_rate" />
        <BreakdownCard dim="campaign_quality" title="Campaign quality (sales-entered)" />
        <BreakdownCard dim="class_raw" title="Class (raw values) - mapping check" limit={25} />
      </div>
      <Note>"Rest" beyond the top-N is visible in the table view of each card (toggle the table icon), together with the Total row from the API.</Note>
    </div>
  );
}
