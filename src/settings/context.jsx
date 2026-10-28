import {createContext, useContext} from 'react';

export const SettingsContext = createContext(null);
export function useSettings(){
  const value=useContext(SettingsContext);
  if(!value) throw new Error('SettingsContext is required');
  return value;
}
