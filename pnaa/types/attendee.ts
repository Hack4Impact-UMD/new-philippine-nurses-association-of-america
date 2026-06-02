export interface Attendee {
  // Document ID === registrationId for WA records, generated for app records.
  registrationId: string;
  eventId: string;
  contactId: string;
  name: string;
  // App-managed: true once the admin marks them present.
  attended: boolean;
  // App-managed: hours earned for this attendee on this event.
  hours: number;
  // National conferences only: sub-events this attendee was marked present at.
  // Empty / unused on other event types. hours = cardinality * event.defaultHours.
  attendedSubeventIds: string[];
  // Source of the record. "wildapricot" rows come from WA registrations; "app"
  // rows are admins manually adding someone who showed up.
  source: "wildapricot" | "app";
  // Member doc ID this attendee links to. Always set for app records;
  // for WA records this mirrors contactId (= WA contact ID = member doc ID).
  memberId: string;

  // WA-only fields (empty / zero for app source)
  registrationTypeId: string;
  registrationType: string;
  organization: string;
  isPaid: boolean;
  registrationFee: number;
  paidSum: number;
  OnWaitlist: boolean;
  Status: string;
}
