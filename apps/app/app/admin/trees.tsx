// Find trees by name or by who made them. Counts only, until someone gives a reason to look at the people. Every look is audited.
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Actions, AdminPage, adminStyles, DataTable, FormDialog, formatDate, Message, Pager, PAGE_SIZE, Pill, QueryState, SearchBox, SecondaryButton, Section, usePagedList } from '@/admin/ui';
import type { Column } from '@/admin/ui';
import type { Page, TreePersonRow, TreeRow } from '@/admin/types';
import { csvDay, downloadCsv } from '@/admin/csv';
import { api } from '@/lib/api';

interface Look {
  tree: TreeRow;
  reason: string;
  page: number;
  data: Page<TreePersonRow>;
}

export default function AdminTrees() {
  const { t, i18n } = useTranslation();
  // Opened from an account's page: that tree is searched for straight away.
  const params = useLocalSearchParams<{ q?: string }>();
  const [q, setQ] = useState(params.q ?? '');
  const [asking, setAsking] = useState<TreeRow | null>(null);
  const [look, setLook] = useState<Look | null>(null);
  const [pageFailed, setPageFailed] = useState(false);
  // The tree whose id was just copied, so its button can say so.
  const [copied, setCopied] = useState<string | null>(null);
  // Ids are long and mean nothing to read, so they stay off the screen. Engineering sometimes asks for one: copy it.
  const copyId = async (tree: TreeRow) => {
    await Clipboard.setStringAsync(tree.id);
    setCopied(tree.id);
  };
  const { query, page, setPage } = usePagedList<TreeRow>(['admin', 'trees'], '/admin/trees', { q });

  const fetchPeople = (tree: TreeRow, reason: string, nextPage: number) =>
    api.post<Page<TreePersonRow>>(`/admin/trees/${tree.id}/people`, {
      reason,
      limit: PAGE_SIZE,
      offset: nextPage * PAGE_SIZE,
    });

  async function turnPage(nextPage: number) {
    if (!look) return;
    setPageFailed(false);
    try {
      const data = await fetchPeople(look.tree, look.reason, nextPage);
      setLook({ ...look, page: nextPage, data });
    } catch {
      setPageFailed(true);
    }
  }

  const columns: Column<TreeRow>[] = [
    {
      key: 'name',
      label: t('admin.trees.name'),
      flex: 2,
      render: (tree) => (
        <View>
          <Text style={adminStyles.cellStrong}>{tree.name}</Text>
          {tree.deleted ? <Pill label={t('admin.users.deleted')} /> : null}
        </View>
      ),
    },
    { key: 'creator', label: t('admin.trees.creator'), render: (tree) => tree.creator_name || t('admin.users.noName') },
    { key: 'people', label: t('admin.trees.people'), flex: 0.6, render: (tree) => tree.people },
    { key: 'shares', label: t('admin.trees.shares'), flex: 0.6, render: (tree) => tree.shares },
    { key: 'created', label: t('admin.trees.created'), render: (tree) => formatDate(tree.created_at, i18n.language) },
    {
      key: 'actions',
      label: t('admin.common.actions'),
      flex: 1.4,
      render: (tree) => (
        <Actions>
          <SecondaryButton label={t('admin.trees.seePeople')} onPress={() => setAsking(tree)} />
          <SecondaryButton label={copied === tree.id ? t('admin.trees.idCopied') : t('admin.trees.copyId')} onPress={() => void copyId(tree)} />
        </Actions>
      ),
    },
  ];

  const peopleColumns: Column<TreePersonRow>[] = [
    { key: 'name', label: t('admin.trees.personName'), flex: 2, render: (person) => (person.name_unknown ? t('admin.trees.nameNotKnown') : person.display_name) },
    { key: 'living', label: t('admin.trees.living'), render: (person) => t(`admin.trees.livingState.${person.living}`) },
    { key: 'account', label: t('admin.trees.account'), render: (person) => (person.has_account ? t('admin.trees.hasAccount') : '-') },
  ];

  return (
    <AdminPage title={t('admin.trees.title')} subtitle={t('admin.trees.subtitle')} gates={['trees']}>
      <SearchBox placeholder={t('admin.trees.search')} onSearch={setQ} initial={params.q ?? ''} />
      {/* Right under the search box: below a full table nobody saw this list appear. */}
      {look ? (
        <Section title={t('admin.trees.peopleOf', { name: look.tree.name })}>
          <Text style={adminStyles.cellMuted}>{t('admin.trees.lookRecorded', { reason: look.reason })}</Text>
          {pageFailed ? <Message text={t('admin.common.failed')} alert /> : null}
          {look.data.rows.length === 0 ? (
            <Message text={t('admin.trees.noPeople')} />
          ) : (
            <>
              <DataTable columns={peopleColumns} rows={look.data.rows} rowKey={(person) => person.id} />
              <Pager page={look.page} total={look.data.total} onPage={turnPage} />
            </>
          )}
          <Actions>
            <SecondaryButton label={t('admin.trees.closeLook')} onPress={() => setLook(null)} />
          </Actions>
        </Section>
      ) : null}

      <QueryState query={query} isEmpty={(data) => data.rows.length === 0} emptyText={t('admin.trees.empty')}>
        {(data) => (
          <>
            <DataTable columns={columns} rows={data.rows} rowKey={(tree) => tree.id} />
            <Pager page={page} total={data.total} onPage={setPage} />
            <Actions>
              <SecondaryButton
                label={t('admin.common.downloadCsv')}
                onPress={() =>
                  downloadCsv(
                    `aywo-trees-${csvDay()}`,
                    [t('admin.trees.name'), t('admin.trees.creator'), t('admin.trees.people'), t('admin.trees.shares'), t('admin.trees.created'), t('admin.trees.csvState')],
                    data.rows.map((tree) => [
                      tree.name,
                      tree.creator_name ?? '',
                      String(tree.people),
                      String(tree.shares),
                      formatDate(tree.created_at, i18n.language),
                      tree.deleted ? t('admin.users.deleted') : '',
                    ]),
                  )
                }
              />
            </Actions>
            <Text style={adminStyles.cellMuted}>{t('admin.common.downloadCsvHelp', { count: data.rows.length })}</Text>
          </>
        )}
      </QueryState>

      {asking ? (
        <FormDialog
          title={t('admin.trees.askTitle', { name: asking.name })}
          text={t('admin.trees.askText')}
          fields={[{ name: 'reason', label: t('admin.common.reason'), minLength: 5, multiline: true }]}
          confirmLabel={t('admin.trees.seePeople')}
          onCancel={() => setAsking(null)}
          onConfirm={async ({ reason }) => {
            const data = await fetchPeople(asking, reason, 0);
            setLook({ tree: asking, reason, page: 0, data });
            setPageFailed(false);
            setAsking(null);
          }}
        />
      ) : null}
    </AdminPage>
  );
}
