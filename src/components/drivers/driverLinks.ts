/** Route of a driver's detail page (registered in App.tsx as /drivers/:code). */
export const driverHref = (code: string) => `/drivers/${code.toLowerCase()}`;
