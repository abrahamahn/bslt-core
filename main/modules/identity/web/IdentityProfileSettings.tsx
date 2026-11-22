// main/modules/identity/web/IdentityProfileSettings.tsx
import { useState, type ReactElement } from 'react';

import { Alert, Button, FormField, Input, Text, TextArea } from '@bslt/ui';
import { useModuleMessages } from '@bslt/web-platform';

import {
  getNextUsernameChangeDate,
  getProfileFieldLabel,
  isUsernameChangeCooldownActive,
  RESERVED_USERNAMES,
} from '../contract';
import enUsMessages from '../i18n/en-US.json';

import { useProfileCompleteness, useProfileUpdate, useUsernameUpdate } from './hooks';
import { ProfileCompletenessCard } from './IdentityCards';
import { formatInternationalPhoneInput, normalizeInternationalPhoneInput } from './phoneFormatting';
import { PROFILE_COUNTRIES, PROFILE_US_STATES } from './profileOptions';

// ============================================================================
// ProfileCompleteness
// ============================================================================

export interface ProfileCompletenessProps {
  className?: string;
}

export const ProfileCompleteness = ({
  className,
}: ProfileCompletenessProps): ReactElement | null => {
  const { data, isLoading, isError } = useProfileCompleteness();

  if (isLoading || isError || data === null) return null;

  return (
    <ProfileCompletenessCard
      percentage={data.percentage}
      missingFields={data.missingFields.map(getProfileFieldLabel)}
      {...(className !== undefined ? { className } : {})}
    />
  );
};

// ============================================================================
// UsernameForm
// ============================================================================

const USERNAME_REGEX = /^[a-z][a-z0-9_]{1,29}$/;
const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

export interface UsernameFormProps {
  currentUsername?: string | null;
  lastUsernameChangeAt?: string | null;
  onSuccess?: () => void;
}

export const UsernameForm = ({
  currentUsername,
  lastUsernameChangeAt,
  onSuccess,
}: UsernameFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const [username, setUsername] = useState(currentUsername ?? '');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const lastChangeDate =
    lastUsernameChangeAt !== null && lastUsernameChangeAt !== undefined
      ? new Date(lastUsernameChangeAt)
      : null;
  const cooldownActive = isUsernameChangeCooldownActive(lastChangeDate);
  const nextChangeDate = getNextUsernameChangeDate(lastChangeDate);

  const validateUsername = (value: string): string | null => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length < 2) return t('identity.username.tooShort');
    if (trimmed.length > 30) return t('identity.username.tooLong');
    if (!USERNAME_REGEX.test(trimmed)) {
      return t('identity.username.invalidFormat');
    }
    if ((RESERVED_USERNAMES as readonly string[]).includes(trimmed)) {
      return t('identity.username.reserved');
    }
    return null;
  };

  const { updateUsername, isLoading, error, reset } = useUsernameUpdate({
    onSuccess: () => {
      setSuccessMessage(t('identity.username.updatedSuccess'));
      reset();
      onSuccess?.();
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const value = e.target.value.toLowerCase();
    setUsername(value);
    if (value.trim().length > 0) {
      setValidationError(validateUsername(value));
    } else {
      setValidationError(null);
    }
  };

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setSuccessMessage(null);
    const trimmed = username.trim().toLowerCase();
    const err = validateUsername(trimmed);
    if (err !== null) {
      setValidationError(err);
      return;
    }
    updateUsername({ username: trimmed });
  };

  const hasChanges = username.trim().toLowerCase() !== (currentUsername ?? '');

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <FormField label={t('identity.username.fieldLabel')} htmlFor="username">
        <Input
          id="username"
          type="text"
          value={username}
          onChange={handleChange}
          placeholder={t('identity.username.placeholder')}
          maxLength={30}
          disabled={cooldownActive}
          required
        />
        {validationError !== null ? (
          <Text size="sm" tone="danger" className="mt-1">
            {validationError}
          </Text>
        ) : null}
        {cooldownActive ? (
          <Text size="sm" tone="muted" className="mt-1">
            {t('identity.username.cooldownHint', { date: nextChangeDate.toLocaleDateString() })}
          </Text>
        ) : null}
        {!cooldownActive ? (
          <Text size="sm" tone="muted" className="mt-1">
            {t('identity.username.rulesHint', { days: String(USERNAME_CHANGE_COOLDOWN_DAYS) })}
          </Text>
        ) : null}
      </FormField>

      {error !== null ? <Alert tone="danger">{error.message}</Alert> : null}

      {successMessage !== null && successMessage.length > 0 ? (
        <Alert tone="success">{successMessage}</Alert>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={!hasChanges || isLoading || cooldownActive || validationError !== null}
        >
          {isLoading ? t('identity.username.saving') : t('identity.username.submit')}
        </Button>
      </div>
    </form>
  );
};

// ============================================================================
// ProfileForm
// ============================================================================

export interface ProfileFormUser {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null | undefined;
  bio?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | null | undefined;
  language?: string | null | undefined;
  website?: string | null | undefined;
}

export interface ProfileFormProps {
  user: ProfileFormUser;
  onSuccess?: () => void;
}

const STATE_OPTIONS_LIST_ID = 'profile-state-options';
const COUNTRY_OPTIONS_LIST_ID = 'profile-country-options';

export const ProfileForm = ({ user, onSuccess }: ProfileFormProps): ReactElement => {
  const t = useModuleMessages(enUsMessages);
  const userFirstName: string = user.firstName ?? '';
  const userLastName: string = user.lastName ?? '';
  const userEmail: string = user.email ?? '';
  const userPhone: string = formatInternationalPhoneInput(user.phone ?? '');
  const normalizedUserPhone: string = normalizeInternationalPhoneInput(user.phone ?? '');
  const userBio: string = user.bio ?? '';
  const userCity: string = user.city ?? '';
  const userState: string = user.state ?? '';
  const userCountry: string = user.country ?? '';
  const userWebsite: string = user.website ?? '';

  const [firstName, setFirstName] = useState(userFirstName);
  const [lastName, setLastName] = useState(userLastName);
  const [phone, setPhone] = useState(userPhone);
  const [bio, setBio] = useState(userBio);
  const [city, setCity] = useState(userCity);
  const [state, setState] = useState(userState);
  const [country, setCountry] = useState(userCountry);
  const [website, setWebsite] = useState(userWebsite);

  const normalize = (value: string): string => {
    const trimmed = value.trim();
    return trimmed !== '' ? trimmed : '';
  };

  const { updateProfile, isLoading, error, reset } = useProfileUpdate({
    onSuccess: () => {
      reset();
      onSuccess?.();
    },
  });

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const normalizedPhone = normalizeInternationalPhoneInput(phone);
    const normalizedBio = normalize(bio);
    const normalizedCity = normalize(city);
    const normalizedState = normalize(state);
    const normalizedCountry = normalize(country);
    const normalizedWebsite = normalize(website);
    updateProfile({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: normalizedPhone !== '' ? normalizedPhone : null,
      bio: normalizedBio !== '' ? normalizedBio : null,
      city: normalizedCity !== '' ? normalizedCity : null,
      state: normalizedState !== '' ? normalizedState : null,
      country: normalizedCountry !== '' ? normalizedCountry : null,
      website: normalizedWebsite !== '' ? normalizedWebsite : null,
    });
  };

  const hasChanges =
    firstName.trim() !== userFirstName ||
    lastName.trim() !== userLastName ||
    normalizeInternationalPhoneInput(phone) !== normalizedUserPhone ||
    normalize(bio) !== userBio ||
    normalize(city) !== userCity ||
    normalize(state) !== userState ||
    normalize(country) !== userCountry ||
    normalize(website) !== userWebsite;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <FormField label={t('identity.profile.emailLabel')} htmlFor="email">
        <Input id="email" type="email" value={userEmail} disabled className="bg-surface" />
        <Text size="sm" tone="muted" className="mt-1">
          {t('identity.profile.emailHint')}
        </Text>
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label={t('identity.profile.firstNameLabel')} htmlFor="firstName">
          <Input
            id="firstName"
            type="text"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
            }}
            placeholder={t('identity.profile.firstNamePlaceholder')}
            maxLength={100}
            required
          />
        </FormField>

        <FormField label={t('identity.profile.lastNameLabel')} htmlFor="lastName">
          <Input
            id="lastName"
            type="text"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
            }}
            placeholder={t('identity.profile.lastNamePlaceholder')}
            maxLength={100}
            required
          />
        </FormField>
      </div>

      <FormField label={t('identity.profile.phoneLabel')} htmlFor="phone">
        <Input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(formatInternationalPhoneInput(e.target.value));
          }}
          placeholder={t('identity.profile.phonePlaceholder')}
          autoComplete="tel"
          inputMode="tel"
          maxLength={24}
        />
      </FormField>

      <FormField label={t('identity.profile.bioLabel')} htmlFor="bio">
        <TextArea
          id="bio"
          value={bio}
          onChange={(e) => {
            setBio(e.target.value);
          }}
          placeholder={t('identity.profile.bioPlaceholder')}
          maxLength={500}
          rows={3}
        />
        <Text size="sm" tone="muted" className="mt-1">
          {t('identity.profile.bioCounter', { count: String(bio.length) })}
        </Text>
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField label={t('identity.profile.cityLabel')} htmlFor="city">
          <Input
            id="city"
            type="text"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
            }}
            placeholder={t('identity.profile.cityPlaceholder')}
            maxLength={100}
          />
        </FormField>

        <FormField label={t('identity.profile.stateLabel')} htmlFor="state">
          <Input
            id="state"
            type="text"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
            }}
            placeholder={t('identity.profile.statePlaceholder')}
            list={STATE_OPTIONS_LIST_ID}
            autoComplete="address-level1"
            maxLength={100}
          />
          <datalist id={STATE_OPTIONS_LIST_ID}>
            {PROFILE_US_STATES.map((stateOption) => (
              <option key={stateOption.code} value={stateOption.name}>
                {stateOption.code}
              </option>
            ))}
          </datalist>
        </FormField>

        <FormField label={t('identity.profile.countryLabel')} htmlFor="country">
          <Input
            id="country"
            type="text"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
            }}
            placeholder={t('identity.profile.countryPlaceholder')}
            list={COUNTRY_OPTIONS_LIST_ID}
            autoComplete="country-name"
            maxLength={100}
          />
          <datalist id={COUNTRY_OPTIONS_LIST_ID}>
            {PROFILE_COUNTRIES.map((countryOption) => (
              <option key={countryOption.code} value={countryOption.name}>
                {countryOption.code}
              </option>
            ))}
          </datalist>
        </FormField>
      </div>

      <FormField label={t('identity.profile.websiteLabel')} htmlFor="website">
        <Input
          id="website"
          type="url"
          value={website}
          onChange={(e) => {
            setWebsite(e.target.value);
          }}
          placeholder={t('identity.profile.websitePlaceholder')}
          maxLength={200}
        />
      </FormField>

      {error !== null ? <Alert tone="danger">{error.message}</Alert> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={!hasChanges || isLoading}>
          {isLoading ? t('identity.profile.saving') : t('identity.profile.submit')}
        </Button>
      </div>
    </form>
  );
};
