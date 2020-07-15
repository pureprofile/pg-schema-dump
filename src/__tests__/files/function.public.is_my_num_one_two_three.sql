CREATE OR REPLACE FUNCTION public.is_my_num_one_two_three(num integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (num IN (1, 2, 3))
$function$
