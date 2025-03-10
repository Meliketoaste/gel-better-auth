module default {

  type user {
    required name: str;
    required email: str;
    required emailVerified: bool;
    image: str;
    required createdAt: datetime;
    required updatedAt: datetime;
  }

  type session {
    required userId: user;
    required token: str;
    required expiresAt: datetime;
    ipAddress: str;
    userAgent: str;
    required createdAt: datetime;
    required updatedAt: datetime;
  }

  type account {
    required userId: user;
    required accountId: str;
    required providerId: str;
    idToken: str;
    accessToken: str;
    refreshToken: str;
    accessTokenExpiresAt: datetime;
    refreshTokenExpiresAt: datetime;
    scope: str;
    password: str;
    required createdAt: datetime;
    required updatedAt: datetime;
  }

  type verification {
    required identifier: str;
    required value: str;
    required expiresAt: datetime;
    required createdAt: datetime;
    required updatedAt: datetime;
  }

}
