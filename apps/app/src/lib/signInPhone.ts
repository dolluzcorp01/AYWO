// The number being signed in with, handed from the phone screen to the code screen in memory. It used to travel in
// the address (/otp?phone=...), which leaves a phone number in the browser's history and in any copied link.
// After a page reload it is gone, and the code screen sends the person back to type the number again.

let phone: string | null = null;

export function setSignInPhone(value: string | null): void {
  phone = value;
}

export function getSignInPhone(): string | null {
  return phone;
}

// Testing only: the code the server handed back because it sends no SMS yet. Never set by a live server.
let testCode: string | null = null;

export function setSignInTestCode(value: string | null): void {
  testCode = value;
}

export function getSignInTestCode(): string | null {
  return testCode;
}
