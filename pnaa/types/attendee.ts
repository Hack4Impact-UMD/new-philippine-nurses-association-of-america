export interface AppEvent {
      registrationId: string;
      eventId: string;
      contactId: string;
      name: string;
      registrationTypeId: string;
      registrationType: string;
      organization: string;
      isPaid: boolean;
      registrationFee: number;
      paidSum: number;
      OnWaitlist: boolean;
      Status: string;
      hasGuests: boolean;
      guestIds?: string[];
}