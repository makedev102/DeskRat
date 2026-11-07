import { describe, expect, it } from 'vitest';
import { setLang } from './i18n';
import { appFolderFor, dirHint, driveOf, errorText, isDriveRoot, pickDir, samePath } from './setup';

describe('isDriveRoot', () => {
  it('узнаёт корень в любом написании', () => {
    for (const p of ['D:', 'D:\\', 'd:/', ' E:\\ ']) expect(isDriveRoot(p)).toBe(true);
  });
  it('обычная папка — не корень', () => {
    for (const p of ['D:\\Games', 'C:\\Users\\vlad', '', '\\\\server\\share', 'DD:\\']) expect(isDriveRoot(p)).toBe(false);
  });
});

describe('appFolderFor', () => {
  it('к корню диска добавляет папку программы', () => {
    expect(appFolderFor('d:\\')).toBe('D:\\DeskRat');
    expect(appFolderFor('E:')).toBe('E:\\DeskRat');
  });
  it('выбранную папку не трогает', () => {
    expect(appFolderFor('D:\\Мои\\Питомец')).toBeNull();
  });
});

describe('driveOf', () => {
  it('достаёт букву диска', () => {
    expect(driveOf('d:\\DeskRat')).toBe('D:');
    expect(driveOf('C:\\Users\\vlad\\DeskRat')).toBe('C:');
  });
  it('без буквы — null', () => {
    expect(driveOf('\\\\server\\share')).toBeNull();
    expect(driveOf('')).toBeNull();
  });
});

describe('errorText', () => {
  it('строку от Rust отдаёт как есть', () => {
    expect(errorText('В эту папку нельзя писать')).toBe('В эту папку нельзя писать');
  });
  it('у Error берёт сообщение', () => {
    expect(errorText(new Error('нет Tauri'))).toBe('нет Tauri');
  });
  it('прочее — общей фразой', () => {
    for (const e of [undefined, null, {}, '', '  ', new Error('')]) expect(errorText(e)).toMatch(/не так/);
  });
});

describe('pickDir', () => {
  it('корень диска меняет на подпапку и запоминает корень', () => {
    expect(pickDir(' d:\\ ', null)).toEqual({ dir: 'D:\\DeskRat', root: 'd:\\' });
  });
  it('корень, от подпапки которого отказались, оставляет как есть', () => {
    expect(pickDir('D:\\', 'D:\\')).toEqual({ dir: 'D:\\', root: null });
  });
  it('обычную папку не трогает', () => {
    expect(pickDir('E:\\Pets', null)).toEqual({ dir: 'E:\\Pets', root: null });
  });
});

describe('dirHint', () => {
  it('по-английски', () => {
    setLang('en');
    try {
      expect(dirHint(0, 2, 'D:\\DeskRat')).toBe('separate drive D:');
      expect(errorText(null)).toMatch(/went wrong/);
    } finally {
      setLang('ru');
    }
  });

  it('последняя — папка пользователя, остальные — диски', () => {
    expect(dirHint(0, 2, 'D:\\DeskRat')).toBe('отдельный диск D:');
    expect(dirHint(1, 2, 'C:\\Users\\vlad\\DeskRat')).toBe('в папке пользователя, на системном диске');
  });
  it('без буквы диска — просто «отдельный диск»', () => {
    expect(dirHint(0, 2, '\\\\server\\share')).toBe('отдельный диск');
  });
});

describe('samePath', () => {
  it('не замечает регистр, слэши и хвостовой разделитель', () => {
    expect(samePath('D:\\DeskRat', ' d:/deskrat/ ')).toBe(true);
  });
  it('разные папки и пустая строка — не то же самое', () => {
    expect(samePath('D:\\DeskRat', 'E:\\DeskRat')).toBe(false);
    expect(samePath('', '')).toBe(false);
  });
});
