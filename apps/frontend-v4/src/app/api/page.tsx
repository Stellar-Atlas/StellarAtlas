import { redirect } from 'next/navigation';

export default function ApiPage(): never {
	redirect('/docs');
}
