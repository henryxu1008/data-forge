// Display naming only. Persistent IDs, snapshot format and database keys stay stable.
export const PRODUCT_NAME='创平数智工场';

// Stored values remain portable between root hosting and repository subpaths.
export const DEFAULT_BRAND_LOGO='/assets/brand-mark.png';
export function brandLogoUrl(logo){
 return logo===DEFAULT_BRAND_LOGO?`${import.meta.env?.BASE_URL||'/'}assets/brand-mark.png`:logo;
}
