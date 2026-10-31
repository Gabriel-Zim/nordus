/** The invite link an admin shares: anyone who opens it can ask to join, and nobody gets in until an admin approves. */
export interface JoinLink {
  token: string;
  createdAt: number;
}

/** A person who proved they own `email` through the invite link and waits for an admin's answer. */
export interface JoinRequest {
  id: string;
  email: string;
  /** The name the Google account carries, when the request came through Google sign-in. */
  name?: string;
  createdAt: number;
}

/** `GET /api/people/join`. Admin only. */
export interface PeopleJoinState {
  link: JoinLink | null;
  requests: JoinRequest[];
}

/** `POST /api/auth/email/verify` with a valid `joinToken` for an email that is not on the sign-in list. No session is issued. */
export interface JoinPending {
  pending: true;
  email: string;
}

export type JoinApproveRole = "member" | "admin" | "guest";
