export { PROFILE_WORLDS, ACCENTS, AVATARS, BLOCKS, VISIBILITY } from './schema';
import type { Customization } from './schema';
export const worldLabels:Record<Customization['world'],string>={minimal:'Минимализм',midnight:'Полночь',glass:'Стекло',cozy:'Уют',cyber:'Кибер',manga:'Манга',y2k:'Нулевые',monochrome:'Монохром'};
export const accentLabels:Record<Customization['accent'],string>={coral:'Коралл',mint:'Мята',violet:'Фиолетовый',amber:'Янтарь',blue:'Синий'};
export const avatarLabels:Record<Customization['avatar'],string>={orbit:'Орбита',arch:'Арка',spark:'Искра',grid:'Мозаика'};
export const blockLabels:Record<Customization['blockOrder'][number],string>={intent:'Сейчас хочу',activities:'Мои занятия',interests:'Интересы',goals:'Цели'};
export const visibilityLabels:Record<Customization['visibility']['status'],string>={self:'Только мне',connection:'После знакомства',everyone:'При просмотре занятия'};
