import { PageHeader } from '#components/layout/page-header.js';
import { useTranslation } from '#i18n/translate.js';

/** A useful destination in place of an unsupported phone workspace. */
export function CadPhoneNotice(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <section className='flex size-full flex-col items-center justify-center gap-6 overflow-auto p-6 text-center'>
      <PageHeader title='SinopiaCAD' />
      <p>{t('common.supportedDevices')}</p>
      <a
        className='inline-flex min-h-11 items-center rounded-md border px-4 focus-visible:focus-outline'
        href='https://sinopialab.com'
      >
        {t('common.openSinopia')}
      </a>
    </section>
  );
}
