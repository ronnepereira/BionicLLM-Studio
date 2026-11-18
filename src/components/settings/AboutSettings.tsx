import { useState } from 'react'
import { Coffee, ExternalLink, Mail } from 'lucide-react'
import { APP_VERSION } from '../../lib/app-version'
import { useUiText } from '../../lib/ui-text'
import { openExternal } from '../../api/backend'
import { MONOGRAM, MONOGRAM_INVERT } from '../layout/brand'
import { ORIGINAL_APP_CREDIT } from '../../lib/ui-brand'

const SUPPORT_EMAIL = 'ronne.pereira@gmail.com'
const paypal = new URL('https://www.paypal.com/cgi-bin/webscr')
paypal.search = new URLSearchParams({
  cmd: '_donations', business: SUPPORT_EMAIL, currency_code: 'USD', amount: '5.00',
  item_name: 'Um café para o BionicLLM Studio', no_shipping: '1',
}).toString()

export function AboutSettings() {
  const text = useUiText()
  const [error, setError] = useState(false)
  return (
    <div className="space-y-6" data-testid="about-settings">
      <div className="flex items-center gap-4">
        <div className="flex items-center justify-center w-16 h-16 shrink-0 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03]">
          <img src={MONOGRAM} alt="" width={38} height={38} className={MONOGRAM_INVERT} />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">BionicLLM Studio</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{text('Version {v0}', { v0: APP_VERSION })}</p>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{text('Your AI studio for local models, chat, agents and tools.')}</p>
      <dl className="space-y-4 border-y border-gray-200 dark:border-white/[0.08] py-5 text-sm">
        <div>
          <dt className="text-xs text-gray-500">{text('Developed by')}</dt>
          <dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">Ronne Pereira</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-xs text-gray-500"><Mail size={13} />{text('Email')}</dt>
          <dd className="mt-1 break-all text-gray-700 dark:text-gray-300">{SUPPORT_EMAIL}</dd>
        </div>
      </dl>
      <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.05] p-4 space-y-3">
        <p className="text-sm text-gray-700 dark:text-gray-300">{text('Enjoying BionicLLM Studio? Support its development with a coffee.')}</p>
        <a href={paypal.href} target="_blank" rel="noopener noreferrer"
          onClick={event => { event.preventDefault(); setError(false); void openExternal(paypal.href).catch(() => setError(true)) }}
          className="lu-primary inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm">
          <Coffee size={16} />{text('Buy me a coffee — US$ 5')}<ExternalLink size={13} />
        </a>
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{text('PayPal opens in your browser. Review the recipient and confirm your contribution there.')}</p>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{text('Could not open PayPal. Try again.')}</p>}
      </div>
      <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{text(ORIGINAL_APP_CREDIT)}</p>

    </div>
  )
}

