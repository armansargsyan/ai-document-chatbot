/** Response of `GET /api/auth/me`: the signed-in user, as verified by the api. */
export interface MeResponse {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
}
