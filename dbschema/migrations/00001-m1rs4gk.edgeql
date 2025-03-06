CREATE MIGRATION m1rs4gkn7iakr7untlx5b2r6tucanlxt3vk6dwosuyaxbexvi5k4qq
    ONTO initial
{
  CREATE TYPE default::user {
      CREATE REQUIRED PROPERTY createdAt: std::datetime;
      CREATE REQUIRED PROPERTY email: std::str;
      CREATE REQUIRED PROPERTY emailVerified: std::bool;
      CREATE PROPERTY image: std::str;
      CREATE REQUIRED PROPERTY name: std::str;
      CREATE REQUIRED PROPERTY updatedAt: std::datetime;
  };
  CREATE TYPE default::account {
      CREATE REQUIRED LINK userId: default::user;
      CREATE PROPERTY accessToken: std::str;
      CREATE PROPERTY accessTokenExpiresAt: std::datetime;
      CREATE REQUIRED PROPERTY accountId: std::str;
      CREATE REQUIRED PROPERTY createdAt: std::datetime;
      CREATE PROPERTY idToken: std::str;
      CREATE PROPERTY password: std::str;
      CREATE REQUIRED PROPERTY providerId: std::str;
      CREATE PROPERTY refreshToken: std::str;
      CREATE PROPERTY refreshTokenExpiresAt: std::datetime;
      CREATE PROPERTY scope: std::str;
      CREATE REQUIRED PROPERTY updatedAt: std::datetime;
  };
  CREATE TYPE default::session {
      CREATE REQUIRED LINK userId: default::user;
      CREATE REQUIRED PROPERTY createdAt: std::datetime;
      CREATE REQUIRED PROPERTY expiresAt: std::datetime;
      CREATE PROPERTY ipAddress: std::str;
      CREATE REQUIRED PROPERTY token: std::str;
      CREATE REQUIRED PROPERTY updatedAt: std::datetime;
      CREATE PROPERTY userAgent: std::str;
  };
  CREATE TYPE default::verification {
      CREATE REQUIRED PROPERTY createdAt: std::datetime;
      CREATE REQUIRED PROPERTY expiresAt: std::datetime;
      CREATE REQUIRED PROPERTY identifier: std::str;
      CREATE REQUIRED PROPERTY updatedAt: std::datetime;
      CREATE REQUIRED PROPERTY value: std::str;
  };
};
