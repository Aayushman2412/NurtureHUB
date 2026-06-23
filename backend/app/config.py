import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    PROJECT_NAME: str = "NurtureHUB API"
    
    # Database
    DATABASE_URL: str = Field(
        default="postgresql://postgres:756824@localhost/NurtureHub", # fallback to our tested URL
        validation_alias="DATABASE_URL"
    )
    
    # Security & JWT
    JWT_SECRET_KEY: str = Field(default="supersecretkeyfornurturehubdevelopment12345", validation_alias="JWT_SECRET_KEY")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    
    # Google OAuth
    GOOGLE_CLIENT_ID: str = Field(default="", validation_alias="GOOGLE_CLIENT_ID")
    
    # SMTP/Email settings for OTP
    SMTP_HOST: str = Field(default="smtp.gmail.com", validation_alias="SMTP_HOST")
    SMTP_PORT: int = Field(default=587, validation_alias="SMTP_PORT")
    SMTP_USER: str = Field(default="", validation_alias="SMTP_USER")
    SMTP_PASSWORD: str = Field(default="", validation_alias="SMTP_PASSWORD")
    SMTP_FROM: str = Field(default="noreply@nurturehub.org", validation_alias="SMTP_FROM")
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
