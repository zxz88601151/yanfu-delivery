-- 使用total_orders代替completed_orders更新pool_type
UPDATE riders SET pool_type = 'advanced' WHERE total_orders >= 100;
UPDATE riders SET pool_type = 'intermediate' WHERE total_orders >= 50 AND total_orders < 100;
UPDATE riders SET pool_type = 'newbie' WHERE total_orders < 50 OR total_orders IS NULL;

SELECT 'pool_type更新完成' as result;
