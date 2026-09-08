'use client';
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode
} from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import {
	SearchDialog,
	SearchDialogClose,
	SearchDialogContent,
	SearchDialogFooter,
	SearchDialogHeader,
	SearchDialogIcon,
	SearchDialogInput,
	SearchDialogList,
	SearchDialogOverlay,
	type SharedProps
} from 'fumadocs-ui/components/dialog/search';
import { searchDocs, type DocsSearchItem } from './docs-search-model';
import { observeDocsHeaderOffset } from './docs-header-offset';

const SearchItems = createContext<readonly DocsSearchItem[]>([]);
function DocsSearchDialog(props: SharedProps): React.JSX.Element {
	const entries = useContext(SearchItems);
	const [search, setSearch] = useState('');
	const items = useMemo(
		() =>
			searchDocs(entries, search).map((item) => ({
				type: 'page' as const,
				id: item.url,
				url: item.url,
				content: item.title + (item.section ? ' · ' + item.section : '')
			})),
		[entries, search]
	);
	return (
		<SearchDialog {...props} search={search} onSearchChange={setSearch}>
			<SearchDialogOverlay />
			<SearchDialogContent>
				<SearchDialogHeader>
					<SearchDialogIcon />
					<SearchDialogInput placeholder="Search guides and API endpoints…" />
					<SearchDialogClose />
				</SearchDialogHeader>
				<SearchDialogList
					items={items}
					Empty={() => (
						<p className="p-4 text-sm">No documentation matches this search.</p>
					)}
				/>
			</SearchDialogContent>
			<SearchDialogFooter>
				Searches documentation locally. No analytics data is queried.
			</SearchDialogFooter>
		</SearchDialog>
	);
}
export function DeveloperDocsProvider({
	children,
	searchItems
}: {
	children: ReactNode;
	searchItems: readonly DocsSearchItem[];
}): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const container = containerRef.current;
		const header = document.querySelector<HTMLElement>('.site-header');
		if (container && header) return observeDocsHeaderOffset(container, header);
	}, []);
	return (
		<div className="developer-docs" ref={containerRef}>
			<SearchItems.Provider value={searchItems}>
				<RootProvider
					theme={{ enabled: false }}
					search={{ SearchDialog: DocsSearchDialog, preload: false }}
				>
					{children}
				</RootProvider>
			</SearchItems.Provider>
		</div>
	);
}
