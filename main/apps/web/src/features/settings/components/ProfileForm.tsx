// main/apps/web/src/features/settings/components/ProfileForm.tsx
/**
 * Profile Form Component
 *
 * Form for updating user profile information including name, bio,
 * location, and website.
 */

import { Alert, Button, FormField, Input, Text, TextArea } from '@bslt/ui';
import { useState, type ReactElement } from 'react';

import { useProfileUpdate } from '../hooks';
import {
  formatInternationalPhoneInput,
  normalizeInternationalPhoneInput,
} from '../utils/phoneFormatting';
import { PROFILE_COUNTRIES, PROFILE_US_STATES } from '../utils/profileOptions';

// ============================================================================
// Local Types (for ESLint type resolution)
// ============================================================================

interface UserLocal {
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

// ============================================================================
// Types
// ============================================================================

export interface ProfileFormProps {
  user: UserLocal;
  onSuccess?: () => void;
}

const STATE_OPTIONS_LIST_ID = 'profile-state-options';
const COUNTRY_OPTIONS_LIST_ID = 'profile-country-options';

// ============================================================================
// Component
// ============================================================================

export const ProfileForm = ({ user, onSuccess }: ProfileFormProps): ReactElement => {
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

  // Success feedback is rendered by the parent (ProfileTab): a successful save
  // refreshes the user, which changes this component's key and remounts it,
  // so local success state would be lost immediately.
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
      {/* Basic Info */}
      <FormField label="Email" htmlFor="email">
        <Input id="email" type="email" value={userEmail} disabled className="bg-surface" />
        <Text size="sm" tone="muted" className="mt-1">
          To change your email, go to the Security tab.
        </Text>
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="First Name" htmlFor="firstName">
          <Input
            id="firstName"
            type="text"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
            }}
            placeholder="Enter your first name"
            maxLength={100}
            required
          />
        </FormField>

        <FormField label="Last Name" htmlFor="lastName">
          <Input
            id="lastName"
            type="text"
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
            }}
            placeholder="Enter your last name"
            maxLength={100}
            required
          />
        </FormField>
      </div>

      {/* Contact */}
      <FormField label="Phone" htmlFor="phone">
        <Input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => {
            setPhone(formatInternationalPhoneInput(e.target.value));
          }}
          placeholder="+1 (555) 123-4567"
          autoComplete="tel"
          inputMode="tel"
          maxLength={24}
        />
      </FormField>

      {/* About */}
      <FormField label="Bio" htmlFor="bio">
        <TextArea
          id="bio"
          value={bio}
          onChange={(e) => {
            setBio(e.target.value);
          }}
          placeholder="Tell us about yourself"
          maxLength={500}
          rows={3}
        />
        <Text size="sm" tone="muted" className="mt-1">
          {String(bio.length)}/500 characters
        </Text>
      </FormField>

      {/* Location */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField label="City" htmlFor="city">
          <Input
            id="city"
            type="text"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
            }}
            placeholder="City"
            maxLength={100}
          />
        </FormField>

        <FormField label="State / Province" htmlFor="state">
          <Input
            id="state"
            type="text"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
            }}
            placeholder="State / Province"
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

        <FormField label="Country" htmlFor="country">
          <Input
            id="country"
            type="text"
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
            }}
            placeholder="Country"
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

      {/* Other */}
      <FormField label="Website" htmlFor="website">
        <Input
          id="website"
          type="url"
          value={website}
          onChange={(e) => {
            setWebsite(e.target.value);
          }}
          placeholder="https://example.com"
          maxLength={200}
        />
      </FormField>

      {error !== null && <Alert tone="danger">{error.message}</Alert>}

      <div className="flex justify-end">
        <Button type="submit" disabled={!hasChanges || isLoading}>
          {isLoading ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
};
