import { Datasource } from "data/CHDatasource";
import { columnFilterDateTime } from "data/columnFilters";
import { BuilderOptionsReducerAction, setColumnByHint, setOptions } from "hooks/useBuilderOptionsState";
import { useEffect, useMemo, useRef } from "react";
import { ColumnHint, DateFilterWithoutValue, Filter, FilterOperator, OrderBy, OrderByDirection, QueryBuilderOptions, SelectedColumn, TableColumn } from "types/queryBuilder";
import { versions as otelVersions } from 'otel';

/**
 * Loads the default configuration for new queries. (Only runs on new queries)
 */
export const useLogDefaultsOnMount = (datasource: Datasource, isNewQuery: boolean, builderOptions: QueryBuilderOptions, builderOptionsDispatch: React.Dispatch<BuilderOptionsReducerAction>) => {
  const didSetDefaults = useRef<boolean>(false);
  useEffect(() => {
    if (!isNewQuery || didSetDefaults.current) {
      return;
    }

    const defaultDb = datasource.getDefaultLogsDatabase() || datasource.getDefaultDatabase();
    const defaultTable = datasource.getDefaultLogsTable() || datasource.getDefaultTable();
    const otelVersion = datasource.getLogsOtelVersion();
    const defaultColumns = datasource.getDefaultLogsColumns();

    const nextColumns: SelectedColumn[] = [];
    for (let [hint, colName] of defaultColumns) {
      nextColumns.push({ name: colName, hint });
    }

    builderOptionsDispatch(setOptions({
      database: defaultDb,
      table: defaultTable || builderOptions.table,
      columns: nextColumns,
      meta: {
        otelEnabled: Boolean(otelVersion),
        otelVersion,
      }
    }));
    didSetDefaults.current = true;
  }, [builderOptions.columns, builderOptions.orderBy, builderOptions.table, builderOptionsDispatch, datasource, isNewQuery]);
};

/**
 * Sets OTEL Logs columns automatically when OTEL is enabled.
 * Does not run if OTEL is already enabled, only when it's changed.
 */
export const useOtelColumns = (otelEnabled: boolean, otelVersion: string, builderOptionsDispatch: React.Dispatch<BuilderOptionsReducerAction>) => {
  const didSetColumns = useRef<boolean>(otelEnabled);
  if (!otelEnabled) {
    didSetColumns.current = false;
  }

  useEffect(() => {
    if (!otelEnabled || didSetColumns.current) {
      return;
    }

    const otelConfig = otelVersions.find(v => v.version === otelVersion);
    const logColumnMap = otelConfig?.logColumnMap;
    if (!logColumnMap) {
      return;
    }

    const columns: SelectedColumn[] = [];
    logColumnMap.forEach((name, hint) => {
      columns.push({ name, hint });
    });

    builderOptionsDispatch(setOptions({ columns }));
    didSetColumns.current = true;
  }, [otelEnabled, otelVersion, builderOptionsDispatch]);
};

// Finds and selects a default log time column, updates when table changes
export const useDefaultTimeColumn = (datasource: Datasource, allColumns: readonly TableColumn[], table: string, timeColumn: SelectedColumn | undefined, otelEnabled: boolean, builderOptionsDispatch: React.Dispatch<BuilderOptionsReducerAction>) => {
  const hasDefaultColumnConfigured = useMemo(() => Boolean(datasource.getDefaultLogsTable()) && datasource.getDefaultLogsColumns().has(ColumnHint.Time), [datasource]);
  const didSetDefaultTime = useRef<boolean>(Boolean(timeColumn) || hasDefaultColumnConfigured);
  const lastTable = useRef<string>(table || '');
  if (table !== lastTable.current) {
    didSetDefaultTime.current = false;
  }

  if (Boolean(timeColumn) || otelEnabled) {
    lastTable.current = table;
    didSetDefaultTime.current = true;
  }

  useEffect(() => {
    if (didSetDefaultTime.current || allColumns.length === 0 || !table) {
      return;
    }

    const col = allColumns.filter(columnFilterDateTime)[0];
    if (!col) {
      return;
    }

    const timeColumn: SelectedColumn = {
      name: col.name,
      type: col.type,
      hint: ColumnHint.Time
    };

    builderOptionsDispatch(setColumnByHint(timeColumn));
    lastTable.current = table;
    didSetDefaultTime.current = true;
  }, [datasource, allColumns, table, builderOptionsDispatch]);
};

// Apply default filters/orderBy on timeColumn change
const timeRangeFilterId = 'timeRange';
export const useDefaultFilters = (table: string, timeColumn: SelectedColumn | undefined, filters: Filter[], orderBy: OrderBy[], builderOptionsDispatch: React.Dispatch<BuilderOptionsReducerAction>) => {
  const lastTimeColumn = useRef<string>(timeColumn?.name || '');
  const lastTable = useRef<string>(table || '');
  if (!timeColumn || table !== lastTable.current) {
    lastTimeColumn.current = '';
  }

  useEffect(() => {
    if (!timeColumn || (timeColumn.name === lastTimeColumn.current) || !table) {
      return;
    }

    const nextFilters: Filter[] = filters.filter(f => f.id !== timeRangeFilterId);
    const timeRangeFilter: DateFilterWithoutValue = {
      type: 'datetime',
      operator: FilterOperator.WithInGrafanaTimeRange,
      filterType: 'custom',
      key: timeColumn.name,
      id: timeRangeFilterId,
      condition: 'AND'
    };
    nextFilters.unshift(timeRangeFilter);

    const nextOrderBy: OrderBy[] = orderBy.filter(o => !o.default);
    const defaultOrderBy: OrderBy = { name: timeColumn?.name, dir: OrderByDirection.DESC, default: true };
    nextOrderBy.unshift(defaultOrderBy);
    
    lastTable.current = table;
    lastTimeColumn.current = timeColumn.name;
    builderOptionsDispatch(setOptions({
      filters: nextFilters,
      orderBy: nextOrderBy
    }));
  }, [table, timeColumn, filters, orderBy, builderOptionsDispatch]);
};
